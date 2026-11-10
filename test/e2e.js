'use strict';
// ทดสอบครบวงจร: สมัคร → ล็อกอิน → ลืมรหัสผ่าน → รีเซ็ต → ห้อง → ต่อสู้ → ต่อเน็ตใหม่ → คะแนนถาวร
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'km-'));
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };
const { server, store } = require('../server');
const { io: ioc } = require('socket.io-client');
const G = require('../game');

assert.strictEqual(G.graphemeLength('ก้'), 1, 'Thai combining marks should count as one grapheme');
assert.strictEqual(G.spellDamage({ text: 'ก้', kind: 'atk' }), 10, 'Thai grapheme damage should be consistent');
assert.strictEqual(G.spellDamage({ text: 'ab', kind: 'atk' }), 20, 'Latin character damage should remain unchanged');
assert.strictEqual(G.spellDamage(G.SPELLS_TH.Fire[0]), G.spellDamage(G.SPELLS.Fire[0]), 'Thai and English spell versions should have matching damage');
assert(G.MONSTERS.MONSTER_KING && Object.keys(G.MONSTERS).length === 12, '12 monsters should be available');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let base;
const post = async (url, body, token) => {
    const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
};
const pass = (m) => origLog('  ✓ ' + m);

function connect(token) {
    return new Promise((resolve, reject) => {
        const s = ioc(base, { auth: { token }, reconnection: false, transports: ['websocket'] });
        s.once('connect_error', (e) => reject(e));
        s.on('resume', (d) => { s.resumed = d; });
        s.once('ready', (d) => { s.ready = d; setTimeout(() => resolve(s), 80); });
    });
}
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    origLog('KeyMage e2e @', base);

    // ---- บัญชี ----
    let r = await post('/api/register', { email: 'a@test.com', username: 'Alice', password: 'password1' });
    assert(r.ok && r.token); const tokA = r.token; pass('สมัครสมาชิกได้');
    r = await post('/api/register', { email: 'b@test.com', username: 'Bob', password: 'password2' });
    assert(r.ok); const tokB = r.token;
    r = await post('/api/register', { email: 'A@test.com', username: 'Other', password: 'password1' });
    assert.strictEqual(r.status, 409); pass('อีเมลซ้ำ (ไม่สนตัวพิมพ์) ถูกปฏิเสธ');
    r = await post('/api/register', { email: 'c@test.com', username: 'alice', password: 'password1' });
    assert.strictEqual(r.status, 409); pass('ชื่อซ้ำถูกปฏิเสธ');
    r = await post('/api/register', { email: 'c@test.com', username: 'Carl', password: 'short' });
    assert.strictEqual(r.status, 400); pass('รหัสผ่านสั้นเกินไปถูกปฏิเสธ');
    r = await post('/api/login', { identifier: 'alice', password: 'wrong-pass' });
    assert.strictEqual(r.status, 401); pass('รหัสผ่านผิดถูกปฏิเสธ');
    r = await post('/api/login', { identifier: 'a@test.com', password: 'password1' });
    assert(r.ok && r.user.username === 'Alice'); pass('ล็อกอินด้วยอีเมลได้');
    for (let i = 0; i < 9; i++) r = await post('/api/login', { identifier: 'bob', password: 'nope-nope' });
    assert.strictEqual(r.status, 429); pass('ใส่รหัสผ่านผิดรัว ๆ ถูกล็อกชั่วคราว');

    // ---- ผู้เยี่ยมชม ----
    r = await post('/api/guest', {});
    assert(r.ok && r.token && /^Guest\d{4}$/.test(r.user.username)); const gs = await connect(r.token);
    assert(gs.ready.me.username === r.user.username); gs.disconnect(); pass('เข้าเล่นแบบผู้เยี่ยมชมได้โดยไม่ต้องสมัคร (' + r.user.username + ')');
    const gEmail = store.getUser(r.user.id).email;
    r = await post('/api/login', { identifier: gEmail, password: 'anything-goes' });
    assert.strictEqual(r.status, 401); pass('บัญชีผู้เยี่ยมชมล็อกอินด้วยรหัสผ่านไม่ได้');
    await post('/api/forgot', { email: gEmail });
    assert(!logs.some(l => l.includes(gEmail))); pass('บัญชีผู้เยี่ยมชมไม่ถูกส่งอีเมลรีเซ็ต');

    // ---- ลืมรหัสผ่าน ----
    r = await post('/api/forgot', { email: 'nobody@test.com' });
    assert(r.ok); assert(!logs.some(l => l.includes('nobody@test.com'))); pass('อีเมลที่ไม่มีในระบบ ตอบเหมือนกัน และไม่ส่งเมล');
    r = await post('/api/forgot', { email: 'a@test.com' });
    assert(r.ok);
    const line = logs.find(l => l.includes('[mail:dev] ลิงก์:'));
    assert(line, 'ต้องมีลิงก์รีเซ็ต'); const token = new URL(line.split('ลิงก์: ')[1].trim()).searchParams.get('token');
    pass('ขอลิงก์รีเซ็ตสำเร็จ (โหมด dev พิมพ์ลิงก์ในคอนโซล)');
    r = await post('/api/reset', { token: 'bogus', password: 'newpassword1' });
    assert.strictEqual(r.status, 400); pass('โทเคนปลอมถูกปฏิเสธ');
    const oldSock = await connect(tokA);
    const kicked = once(oldSock, 'kicked');
    r = await post('/api/reset', { token, password: 'newpassword1' });
    assert(r.ok); pass('ตั้งรหัสผ่านใหม่สำเร็จ');
    await kicked; pass('เซสชันเดิมถูกเตะออกหลังเปลี่ยนรหัสผ่าน');
    r = await post('/api/reset', { token, password: 'anotherpass1' });
    assert.strictEqual(r.status, 400); pass('ลิงก์ใช้ซ้ำไม่ได้');
    r = await post('/api/login', { identifier: 'alice', password: 'password1' });
    assert.strictEqual(r.status, 401); pass('รหัสผ่านเก่าใช้ไม่ได้แล้ว');
    r = await post('/api/login', { identifier: 'alice', password: 'newpassword1' });
    assert(r.ok); const tokA2 = r.token; pass('ล็อกอินด้วยรหัสผ่านใหม่ได้');
    await assert.rejects(connect(tokA), /unauthorized/); pass('โทเคนเก่าเชื่อมต่อ socket ไม่ได้');

    // ---- เกม ----
    const A = await connect(tokA2), B = await connect(tokB);
    A.on('spells', (h) => { A.hand = h; }); B.on('spells', (h) => { B.hand = h; });
    A.emit('join_room', { roomId: 'test1', selectedClass: 'Lightning', selectedMonster: 'SLIME', selectedLanguage: 'th' });
    await once(A, 'waiting_room_update');
    B.emit('join_room', { roomId: 'test1', selectedClass: 'Fire', selectedMonster: 'DRAGON', selectedLanguage: 'mix' });
    let room = await once(B, 'waiting_room_update');
    assert.strictEqual(room.players.length, 2); assert.strictEqual(room.monster.key, 'SLIME');
    assert.strictEqual(room.monster.maxHp, G.hpForParty(G.MONSTERS.SLIME.maxHp, 2)); pass('เข้าห้องเดียวกัน HP บอสปรับตามจำนวนคน');
    B.emit('start_battle'); await sleep(100);
    A.emit('start_battle');
    const bs = await once(B, 'battle_started');
    assert.strictEqual(bs.monster.hp, room.monster.maxHp); pass('หัวหน้าห้องเริ่มรบได้ คนอื่นเริ่มไม่ได้');
    await sleep(100);
    assert(A.hand.length === 3 && B.hand.length === 3);
    assert(A.hand.every(sp => /[\u0E00-\u0E7F]/.test(sp.text)), 'Thai mode should only deal Thai spells');
    assert(B.hand.every(sp => ['en','th'].includes(/^[a-z _]+$/i.test(sp.text) ? 'en' : /[\u0E00-\u0E7F]/.test(sp.text) ? 'th' : 'other')), 'Mixed mode should deal supported spell text');
    pass('ได้รับคาถาตามภาษาที่เลือก (ไทย / ผสม)');

    A.emit('cast_spell', { spell: 'not a real spell' }); await sleep(150);
    let upd = null; A.on('update_battle_state', (d) => { upd = d; });
    const sp = A.hand[0];
    A.emit('cast_spell', { spell: sp.text.toUpperCase() });
    await sleep(200);
    assert(upd && upd.damage > 0 && upd.spell === sp.text); pass('ร่ายคาถาจริงได้ ดาเมจตรงสูตร');
    assert.strictEqual(upd.damage, G.spellDamage(sp));
    assert(upd.combo === 1 && upd.tier >= 1 && typeof upd.delayMs === 'number' && upd.nextIn > 0); pass('ร่ายแล้วเริ่มคอมโบ 1 และเซิร์ฟเวอร์แจ้งเวลาโจมตีบอสที่อัปเดต');

    // ยิงจนบอสตาย
    const dead = once(A, 'monster_dead', 60000);
    let guard = 0;
    while (guard++ < 400) {
        for (const s of [A, B]) {
            if (!s.hand || !s.hand.length) continue;
            const best = [...s.hand].sort((a, b) => G.spellDamage(b) - G.spellDamage(a))[0];
            s.emit('cast_spell', { spell: best.text });
        }
        await sleep(130);
        if (guard % 5 === 0 && !A.connected) break;
        if (store.getUser(A.ready.me.id).score > 0 && room.status === 'x') break;
        const state = await Promise.race([dead.then(() => 'dead'), sleep(1).then(() => 'go')]);
        if (state === 'dead') break;
    }
    const res = await dead;
    assert(res.results.length === 2 && res.results[0].damage >= res.results[1].damage); pass('บอสตาย ได้ผลสรุปเรียงตามดาเมจ');
    assert(res.results.every(x => x.bounty > 0)); pass('ทุกคนได้โบนัสชัยชนะ');
    assert(res.results.every(x => x.maxCombo >= 1)); pass('ผลสรุปบอกคอมโบสูงสุดของแต่ละคน');
    assert(res.results.some(x => x.noDamage && x.nd === Math.round(G.MONSTERS.SLIME.bounty * G.COMBO.noDamageBonus))); pass('ชนะโดยไม่โดนตีเลย ได้โบนัส No Damage');
    const ua = store.getUser(A.ready.me.id);
    assert(ua.score > 0 && ua.wins === 1); pass('คะแนนและสถิติถูกบันทึกในบัญชี: ' + ua.score);


    // ---- จอมเวทย์ Hogwarts + รูปภาพ ----
    {
        const art = A.ready.config.art;
        assert(Object.keys(art.mage).length === 20 && Object.keys(art.avatar).length === 20 && art.mage.Hogwarts && art.avatar.Hogwarts, 'ต้องมีรูปการ์ดและอวาตาร์ครบ 20 สาย');
        assert(!Object.keys(art.monster).length || Object.keys(art.monster).every(k => G.MONSTERS[k])); pass('เซิร์ฟเวอร์ส่งรายการรูปให้ไคลเอนต์ครบ 20 สาย (มอนสเตอร์ที่ยังไม่มีรูปใช้อิโมจิแทน)');
        assert(A.ready.config.classes.includes('Hogwarts') && A.ready.config.spells.Hogwarts.length === 15 && A.ready.config.spellsThai.Hogwarts.length === 15); pass('มีสาย Hogwarts คาถา 15 ใบ (อังกฤษ+ไทย)');
        for (const [lang, cls] of [['en', 'Hogwarts'], ['th', 'Hogwarts'], ['en', 'Slifer'], ['th', 'Obelisk'], ['th', 'ShadowMonarch'], ['en', 'NeoBlue'], ['th', 'Ra'], ['en', 'MegaRayquaza'], ['th', 'MegaRayquaza']]) {
            assert(art.mage[cls] && art.avatar[cls], 'ต้องมีรูป ' + cls);
            await sleep(1100); // ตัวจำกัดอัตรา join_room (ผู้เล่นจริงไม่เข้าห้องถี่ขนาดนี้)
            A.emit('join_room', { roomId: 'sp' + lang + cls, selectedClass: cls, selectedMonster: 'CYCLOPS', selectedLanguage: lang });
            await once(A, 'waiting_room_update'); A.emit('start_battle'); await once(A, 'battle_started'); await sleep(150);
            const pool = (lang === 'en' ? G.SPELLS : G.SPELLS_TH)[cls].map(x => x.text);
            assert(A.hand.length === 3 && A.hand.every(x => pool.includes(x.text)), JSON.stringify(A.hand));
            let got = null; A.once('update_battle_state', (d) => { got = d; });
            const sp0 = A.hand[0]; A.emit('cast_spell', { spell: sp0.text }); await sleep(250);
            assert(got && got.damage > 0); A.emit('leave_room'); await sleep(150);
        }
        pass('สายพิเศษ (Hogwarts + 5 สายใหม่) เข้าห้อง/ร่ายคาถาได้ทั้งโหมดอังกฤษและไทย');
    }

    // ---- คอมโบ / หน่วงเวลาบอส / คอมโบขาด ----
    {
        let st = null, me = null, atk = null;
        B.on('update_battle_state', (d) => { st = d; }); B.on('me_state', (d) => { me = d; }); B.on('monster_attack', (d) => { atk = d; });
        B.emit('join_room', { roomId: 'combo1', selectedClass: 'Fire', selectedMonster: 'CYCLOPS', selectedLanguage: 'en' });
        await once(B, 'waiting_room_update'); B.emit('start_battle');
        const started = await once(B, 'battle_started'); await sleep(1200);
        const pick = () => B.hand.find(s => s.kind === 'atk' || s.kind === 'ult');
        const first = pick(); const tier1 = G.wordTier(first);
        B.emit('cast_spell', { spell: first.text }); await sleep(250);
        const speed = started.attackMs;
        assert(st.combo === 1 && st.tier === tier1); assert(st.delayMs > 0, 'ต้องหน่วงเวลาบอส');
        assert(st.nextIn > speed - 1300 && st.nextIn <= speed, `nextIn=${st.nextIn}`);
        pass(`ร่ายคำระดับ ${tier1} หน่วงเวลาบอส +${st.delayMs}ms (ไม่เกิน 1 รอบเต็ม)`);
        for (let i = 0; i < 2; i++) { const sp2 = pick(); B.emit('cast_spell', { spell: sp2.text }); await sleep(250); }
        assert(me.combo === 3 && me.comboMult > 1 && me.comboMult <= me.comboCap + 1e-9, JSON.stringify(me)); pass(`คอมโบ 3 ตัวคูณคะแนน ×${me.comboMult}`);
        await once(B, 'monster_attack', 12000); await sleep(150);
        assert(atk.players[B.ready.me.id].broke === true && me.combo === 0 && me.hits === 1 && me.maxCombo === 3); pass('โดนบอสตีแล้วคอมโบขาด (คอมโบสูงสุดยังเก็บไว้)');
        B.emit('leave_room'); await sleep(150);
    }

    // ---- ต่อเน็ตใหม่กลางห้อง ----
    A.emit('join_room', { roomId: 'test2', selectedClass: 'Fire', selectedMonster: 'SLIME', selectedLanguage: 'th' });
    await once(A, 'waiting_room_update');
    A.disconnect(); await sleep(150);
    const A2 = await connect(tokA2);
    const resume = A2.resumed;
    assert(resume, 'ต้องได้รับ resume');
    assert.strictEqual(resume.room.id, 'TEST2'); assert.strictEqual(resume.language, 'th'); pass('หลุดแล้วต่อใหม่ → กลับเข้าห้องเดิมพร้อมภาษาคาถาเดิม');
    A2.emit('leave_room'); await sleep(100);

    // ---- สแปม ----
    let kicks = 0; B.on('kicked', () => kicks++);
    const C = await connect(tokB);
    await sleep(200); assert.strictEqual(kicks, 1); pass('ล็อกอินซ้อนจากอีกที่ → เซสชันเก่าถูกเตะ');
    let errs = 0; C.on('join_error', () => errs++);
    for (let i = 0; i < 50; i++) C.emit('join_room', { roomId: 'SPAM' + i });
    await sleep(300);
    const health = await (await fetch(base + '/health')).json();
    assert(health.rooms <= 6, 'rooms=' + health.rooms); pass('สแปมสร้างห้องถูกจำกัดอัตรา (ห้อง ' + health.rooms + ')');

    store.flushSync();
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8'));
    assert(!JSON.stringify(saved).includes('newpassword1')); pass('ไฟล์ข้อมูลไม่มีรหัสผ่านตัวจริง (เก็บเป็น scrypt hash)');
    origLog('\nผ่านทุกข้อ ✅');
    process.exit(0);
})().catch((e) => { origLog('\n❌ ล้มเหลว:', e); process.exit(1); });
