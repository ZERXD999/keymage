'use strict';
// ทดสอบโหลด: จำลองผู้เล่นพิมพ์จริง ๆ N คน (ค่าเริ่มต้น 60) กระจายห้องละ 8 คน
//   node test/loadtest.js [จำนวนบอท] [วินาที] [URL เซิร์ฟเวอร์ที่รันอยู่แล้ว]
// ถ้าไม่ระบุ URL จะเปิดเซิร์ฟเวอร์ชั่วคราวให้เอง (ข้อมูลทดสอบไม่ปนกับของจริง)
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require('socket.io-client');
const G = require('../game');

const N = Number(process.argv[2]) || 60;
const SECONDS = Number(process.argv[3]) || 60;
let URL_BASE = process.argv[4];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

function cpuSec(pid) {
    try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; } catch (e) { return null; }
}

(async () => {
    let child = null;
    if (!URL_BASE) {
        const port = 3900 + Math.floor(Math.random() * 90);
        child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
            env: { ...process.env, PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kmload-')), HOST: '127.0.0.1' }, stdio: 'ignore'
        });
        URL_BASE = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 50; i++) { try { await fetch(URL_BASE + '/health'); break; } catch (e) { await sleep(100); } }
    }
    console.log(`โหลดเทสต์: ${N} ผู้เล่น × ${SECONDS} วินาที → ${URL_BASE}`);
    const tag = Date.now().toString(36);
    const lat = []; let casts = 0, errors = 0, battles = 0, wins = 0, losses = 0, disconnects = 0;
    const errorMessages = Object.create(null), joinErrors = Object.create(null);
    const classes = Object.keys(G.SPELLS);
    const mons = ['OGRE', 'NAGA', 'SKELETON_MAGE', 'CYCLOPS'];
    const bots = [];
    const t0 = Date.now();

    async function makeBot(i) {
        const email = `bot${i}_${tag}@load.test`;
        const r = await (await fetch(URL_BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, username: `Bot${i}_${tag}`.slice(0, 16), password: 'loadtest-pass' }) })).json();
        if (!r.ok) throw new Error('register failed: ' + JSON.stringify(r));
        const roomNo = Math.floor(i / 8);
        const bot = { i, hand: [], alive: true, timer: null, sentAt: new Map(), cps: 2 + Math.random() * 3, host: i % 8 === 0, language: ['en', 'th', 'mix'][i % 3],
            roomId: `LOAD${roomNo}`, cls: classes[i % classes.length], mon: mons[roomNo % mons.length] };
        const s = io(URL_BASE, { auth: { token: r.token }, transports: ['websocket'], reconnection: false });
        bot.s = s;
        const join = () => s.emit('join_room', { roomId: bot.roomId, selectedClass: bot.cls, selectedMonster: bot.mon, selectedLanguage: bot.language });
        const plan = () => {
            clearTimeout(bot.timer);
            if (!bot.alive || !bot.hand.length) return;
            const spell = bot.hand.slice().sort((a, b) => G.graphemeLength(a.text) - G.graphemeLength(b.text))[Math.floor(Math.random() * 2) % bot.hand.length] || bot.hand[0];
            bot.timer = setTimeout(() => { bot.sentAt.set(spell.text, Date.now()); casts++; s.emit('cast_spell', { spell: spell.text }); }, 450 + (G.graphemeLength(spell.text) / bot.cps) * 1000);
        };
        s.on('ready', () => { bot.me = r.user.id; setTimeout(join, bot.host ? 0 : 300 + Math.random() * 1500); });
        s.on('waiting_room_update', (room) => { if (bot.host && room.status === 'waiting' && room.players.length >= 8 - (i >= 56 ? 4 : 0)) setTimeout(() => s.emit('start_battle'), 2500); });
        s.on('battle_started', () => { battles++; bot.alive = true; });
        s.on('spells', (h) => { bot.hand = h; plan(); });
        s.on('me_state', (m) => { bot.alive = m.alive; });
        s.on('monster_attack', () => plan()); // โดนล้างแล้วเริ่มพิมพ์ใหม่
        s.on('update_battle_state', (d) => {
            if (d.casterId === bot.me && bot.sentAt.has(d.spell)) { lat.push(Date.now() - bot.sentAt.get(d.spell)); bot.sentAt.delete(d.spell); }
        });
        const again = (won) => { won ? wins++ : losses++; clearTimeout(bot.timer); bot.hand = []; setTimeout(join, 1200 + Math.random() * 800); };
        s.on('monster_dead', () => again(true));
        s.on('battle_lost', () => again(false));
        s.on('error_msg', (msg) => { errors++; const k = String(msg || 'unknown'); errorMessages[k] = (errorMessages[k] || 0) + 1; });
        s.on('join_error', (msg) => { errors++; const k = String(msg || 'unknown'); joinErrors[k] = (joinErrors[k] || 0) + 1; setTimeout(join, 2000); });
        s.on('disconnect', () => { disconnects++; });
        s.on('connect_error', () => { errors++; });
        bots.push(bot);
    }

    // สมัครทีละกลุ่มเล็ก ๆ เหมือนคนทยอยเข้า
    for (let i = 0; i < N; i += 10) {
        await Promise.all(Array.from({ length: Math.min(10, N - i) }, (_, k) => makeBot(i + k)));
    }
    console.log(`สมัคร+เชื่อมต่อครบ ${N} คนใน ${((Date.now() - t0) / 1000).toFixed(1)} วิ — เริ่มวัดผล`);
    const cpu0 = child ? cpuSec(child.pid) : null; const w0 = Date.now(); const latStart = lat.length;
    let maxLag = 0, maxRss = 0;
    const mon = setInterval(async () => {
        try { const h = await (await fetch(URL_BASE + '/health')).json(); maxLag = Math.max(maxLag, h.eventLoopLagMs.max); maxRss = Math.max(maxRss, h.rssMB); } catch (e) { /* ignore */ }
    }, 2000);
    await sleep(SECONDS * 1000);
    clearInterval(mon);
    const cpu1 = child ? cpuSec(child.pid) : null;
    const l = lat.slice(latStart);
    const h = await (await fetch(URL_BASE + '/health')).json();
    console.log('\n===== ผลลัพธ์ =====');
    console.log(`ผู้เล่นออนไลน์ที่เซิร์ฟเวอร์เห็น : ${h.online}  | ห้อง: ${h.rooms}`);
    console.log(`ร่ายคาถา ${casts} ครั้ง | รบจบ ชนะ ${wins} แพ้ ${losses} | error ${errors} | หลุด ${disconnects}`);
    if (Object.keys(errorMessages).length) console.log('Event errors:', errorMessages);
    if (Object.keys(joinErrors).length) console.log('Join errors:', joinErrors);
    console.log(`ดีเลย์ ร่าย→เห็นผล (ในเครื่องเดียวกัน): p50 ${pct(l, .5)}ms  p95 ${pct(l, .95)}ms  p99 ${pct(l, .99)}ms  max ${Math.max(0, ...l)}ms`);
    console.log(`Event-loop lag ของเซิร์ฟเวอร์     : p99 ${h.eventLoopLagMs.p99}ms  max ${maxLag}ms  (ยิ่งน้อยยิ่งลื่น; >100ms = เริ่มกระตุก)`);
    console.log(`RAM เซิร์ฟเวอร์ (RSS)              : ${maxRss}MB`);
    if (cpu0 != null && cpu1 != null) console.log(`CPU เซิร์ฟเวอร์เฉลี่ย                : ${(((cpu1 - cpu0) / ((Date.now() - w0) / 1000)) * 100).toFixed(1)}% ของ 1 คอร์`);
    bots.forEach(b => b.s.close());
    if (child) child.kill();
    process.exit(0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
