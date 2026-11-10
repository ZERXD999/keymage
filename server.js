'use strict';

require('./lib/env').loadEnv();
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const { Server } = require('socket.io');

const G = require('./game');
const { Store } = require('./lib/store');
const { createMailer, lanUrls } = require('./lib/mailer');
const { createAuthRouter } = require('./lib/auth');

/* ======================= ค่าตั้งต้น ======================= */
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOM_LEN = 16;
const MAX_ROOMS = 200;
const MAX_PLAYERS_PER_ROOM = 8;
const MIN_CAST_INTERVAL_MS = 100;
const LEADERBOARD_SIZE = 100;
const LEADERBOARD_THROTTLE_MS = 1000;
const OFFLINE_GRACE_MS = 25000; // หลุดการเชื่อมต่อแล้วยังเก็บที่ไว้ให้กลับเข้ามาได้

const baseUrl = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || lanUrls(PORT)[0] || `http://localhost:${PORT}`).replace(/\/+$/, '');
const store = new Store(path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'db.json'));
const mailer = createMailer(process.env, PORT);

/* ======================= รูปภาพ (วางไฟล์ในโฟลเดอร์ แล้วเกมจะใช้เองโดยไม่ต้องแก้โค้ด) =======================
   public/img/mages/<สายอาชีพ>.webp|png|jpg        เช่น Fire.webp  (ภาพการ์ดเต็ม)
   public/img/mages/<สายอาชีพ>-av.webp|png         ภาพวงกลมเล็ก (ไม่มีก็ใช้อิโมจิแทน)
   public/img/monsters/<มอนสเตอร์>.webp|png|jpg   เช่น SLIME.png, Skeleton_Warrior.png, Illusion_Knight.png
   ไม่มีไฟล์ของตัวไหน ตัวนั้นจะแสดงเป็นอิโมจิเหมือนเดิม */
const IMG_DIR = path.join(__dirname, 'public', 'img');
const normKey = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const MONSTER_ALIAS = { illusionknight: 'EXALTED_KNIGHT', ancientdragon: 'DRAGON', skeletonwarrior: 'SKELETON', monsterking: 'MONSTER_KING', kingofmonsters: 'MONSTER_KING' };
const MAGE_ALIAS = { hogwartswizard: 'Hogwarts' };
let artCache = { at: 0, data: null };
function listArt() {
    if (artCache.data && Date.now() - artCache.at < 3000) return artCache.data;
    const out = { mage: {}, avatar: {}, monster: {} };
    const scan = (sub, apply) => {
        let files = [];
        try { files = fs.readdirSync(path.join(IMG_DIR, sub)); } catch (e) { return; }
        for (const f of files) {
            const m = /^(.+?)(-av)?\.(webp|png|jpe?g|gif|svg)$/i.exec(f);
            if (!m) continue;
            let v = 0; try { v = Math.round(fs.statSync(path.join(IMG_DIR, sub, f)).mtimeMs); } catch (e) { /* ignore */ }
            apply(normKey(m[1]), !!m[2], `/img/${sub}/${encodeURIComponent(f)}?v=${v}`);
        }
    };
    const classKeys = Object.keys(G.SPELLS);
    scan('mages', (k, isAv, url) => {
        const key = MAGE_ALIAS[k] || classKeys.find(c => normKey(c) === k || normKey(c) + 'mage' === k);
        if (key) (isAv ? out.avatar : out.mage)[key] = url;
    });
    scan('monsters', (k, isAv, url) => {
        if (isAv) return;
        const key = MONSTER_ALIAS[k] || Object.entries(G.MONSTERS).find(([mk, m]) => normKey(mk) === k || normKey(m.name) === k);
        const resolved = typeof key === 'string' ? key : key && key[0];
        if (resolved) out.monster[resolved] = url;
    });
    artCache = { at: Date.now(), data: out };
    return out;
}

/* ======================= ข้อมูลที่ส่งให้ไคลเอนต์ ======================= */
const CONFIG = {
    playerMaxHp: G.PLAYER_MAX_HP,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    classes: Object.keys(G.SPELLS),
    spells: G.SPELLS,
    spellsThai: G.SPELLS_TH,
    combo: G.COMBO,
    kinds: G.KIND_RULES,
    hpScale: 0.3,
    monsters: Object.entries(G.MONSTERS).map(([key, m]) => ({
        key, name: m.name, emoji: m.emoji, maxHp: m.maxHp, damage: m.damage, speedMs: m.speed,
        rec: m.rec, tier: m.tier, scoreMult: m.scoreMult, bounty: m.bounty
    }))
};

/* ======================= สถานะรันไทม์ ======================= */
const players = new Map(); // userId -> ผู้เล่นที่ออนไลน์ (หรือเพิ่งหลุด)
const rooms = new Map();   // roomId -> ห้อง
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function cleanRoomId(v) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001f\u007f<>\s]/g, '').toUpperCase().slice(0, MAX_ROOM_LEN);
}

/* ======================= Express ======================= */
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 10000,
    pingTimeout: 20000,
    connectTimeout: 10000,
    maxHttpBufferSize: 2e3,
    perMessageDeflate: false // ข้อความเล็ก ไม่คุ้มกับ CPU ที่เสียไปบีบอัด
});

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

app.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        online: [...players.values()].filter(p => p.online).length,
        rooms: rooms.size,
        accounts: Object.keys(store.data.users).length,
        rssMB: Math.round(mem.rss / 1048576),
        heapMB: Math.round(mem.heapUsed / 1048576),
        eventLoopLagMs: { p99: +(loopDelay.percentile(99) / 1e6).toFixed(1), max: +(loopDelay.max / 1e6).toFixed(1) },
        mail: mailer.enabled ? 'smtp' : 'console-dev'
    });
});

app.use('/api', createAuthRouter({
    store, mailer, baseUrl,
    onPasswordReset: (userId) => kickUser(userId, 'รหัสผ่านถูกเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่')
}));
const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/reset', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

/* ======================= อันดับ ======================= */
let lbCache = { online: 0, list: [] };
let lbTimer = null;
let lbDirty = true;

function buildLeaderboard() {
    const list = Object.values(store.data.users)
        .filter(u => u.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, LEADERBOARD_SIZE)
        .map(u => ({ id: u.id, username: u.username, score: u.score, on: !!(players.get(u.id) && players.get(u.id).online) }));
    let online = 0;
    for (const p of players.values()) if (p.online) online++;
    lbCache = { online, list };
    lbDirty = false;
    return lbCache;
}
function scheduleLeaderboard() {
    lbDirty = true;
    if (lbTimer) return;
    lbTimer = setTimeout(() => {
        lbTimer = null;
        io.to('lobby').emit('update_leaderboard', buildLeaderboard());
    }, LEADERBOARD_THROTTLE_MS);
}

/* ======================= ห้อง ======================= */
const toUser = (id) => io.to('u:' + id);
const baseOf = (room) => G.MONSTERS[room.monster.key];

function previewHp(room) { return G.hpForParty(baseOf(room).maxHp, room.ids.length); }

function publicRoom(room) {
    const m = room.monster;
    const base = baseOf(room);
    return {
        id: room.id,
        status: room.status,
        hostId: room.hostId,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        monster: {
            key: m.key, name: m.name, emoji: m.emoji, rec: base.rec, baseHp: base.maxHp,
            maxHp: room.status === 'waiting' ? previewHp(room) : m.maxHp, hp: m.hp
        },
        players: room.ids.map(id => players.get(id)).filter(Boolean)
            .map(p => ({ id: p.id, username: p.username, class: p.class, alive: p.alive, online: p.online }))
    };
}
const emitRoom = (room) => io.to(room.channel).emit('waiting_room_update', publicRoom(room));

function meState(p) {
    return { hp: p.hp, alive: p.alive, guard: p.guard, counter: p.counter,
        combo: p.combo, comboMult: +G.comboMult(p.combo, p.comboTier).toFixed(2), comboCap: p.comboTier ? G.COMBO.tiers[p.comboTier].cap : 1, maxCombo: p.maxCombo, hits: p.hits };
}
// คาถาในมือที่ส่งให้ไคลเอนต์ (แนบระดับความยากของคำ เพื่อแสดงผลคอมโบ)
const handView = (p) => p.hand.map(s => ({ ...s, tier: G.wordTier(s) }));
const emitMe = (p) => toUser(p.id).emit('me_state', meState(p));

function setLobby(p) {
    const sock = p.socketId && io.sockets.sockets.get(p.socketId);
    if (sock) { sock.join('lobby'); sock.emit('update_leaderboard', lbDirty ? buildLeaderboard() : lbCache); }
}

function clearAttackTimer(room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
}
// ตั้งเวลาโจมตีของบอสตาม nextAttackAt (เลื่อนได้จากคอมโบ จึงไม่ใช้ setInterval)
function scheduleAttack(room) {
    clearAttackTimer(room);
    room.timer = setTimeout(() => {
        try { monsterAttack(room); } catch (e) { console.error('[error] monsterAttack', e); }
    }, Math.max(0, room.nextAttackAt - Date.now()));
}

function destroyRoom(room) {
    clearAttackTimer(room);
    rooms.delete(room.id);
}

function detach(p, room) {
    const sock = p.socketId && io.sockets.sockets.get(p.socketId);
    if (sock) sock.leave(room.channel);
    p.roomId = null;
    p.hand = [];
    p.guard = false; p.counter = 0; p.alive = true; p.hp = G.PLAYER_MAX_HP;
    p.combo = 0; p.comboTier = 0; p.hits = 0; p.maxCombo = 0;
}

function leaveRoom(userId) {
    const p = players.get(userId);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room) { p.roomId = null; return; }
    room.ids = room.ids.filter(id => id !== userId);
    detach(p, room);
    setLobby(p);
    if (room.ids.length === 0) return destroyRoom(room);
    if (room.hostId === userId) {
        room.hostId = room.ids.find(id => players.get(id) && players.get(id).online) || room.ids[0];
    }
    if (room.status === 'playing' && !room.ids.some(id => players.get(id) && players.get(id).alive)) {
        return finishDefeat(room);
    }
    emitRoom(room);
}

function results(room) {
    return room.ids.map(id => players.get(id)).filter(Boolean)
        .map(p => ({ id: p.id, username: p.username, cls: p.class, damage: p.dmg, earned: p.earned, alive: p.alive, maxCombo: p.maxCombo, noDamage: p.alive && p.hits === 0 }))
        .sort((a, b) => b.damage - a.damage);
}

function endBattle(room) {
    clearAttackTimer(room);
    room.status = 'finished';
}

function releaseMembers(room) {
    for (const id of [...room.ids]) {
        const p = players.get(id);
        if (!p) continue;
        detach(p, room);
        setLobby(p);
        const u = store.getUser(id);
        if (u) toUser(id).emit('profile', { score: u.score, wins: u.wins });
    }
    room.ids = [];
    destroyRoom(room);
}

function finishVictory(room, killer) {
    endBattle(room);
    const base = baseOf(room);
    for (const id of room.ids) {
        const p = players.get(id);
        if (!p) continue;
        const bounty = p.alive ? base.bounty : Math.round(base.bounty / 2);
        // No Damage: รอดครบโดยไม่เสียพลังชีวิตเลย (โล่กันได้ไม่นับว่าโดนตี) ได้โบนัสเพิ่ม
        const nd = p.alive && p.hits === 0 ? Math.round(base.bounty * G.COMBO.noDamageBonus) : 0;
        p.earned += bounty + nd;
        p.bounty = bounty;
        p.ndBonus = nd;
        store.addScore(id, bounty + nd);
        store.addResult(id, true);
    }
    const res = results(room).map(r => ({ ...r, bounty: (players.get(r.id) || {}).bounty || 0, nd: (players.get(r.id) || {}).ndBonus || 0 }));
    io.to(room.channel).emit('monster_dead', {
        killer: killer ? killer.username : '',
        monster: { key: room.monster.key, name: room.monster.name, emoji: room.monster.emoji },
        results: res
    });
    releaseMembers(room);
    scheduleLeaderboard();
}

function finishDefeat(room) {
    endBattle(room);
    for (const id of room.ids) store.addResult(id, false);
    io.to(room.channel).emit('battle_lost', {
        monster: { key: room.monster.key, name: room.monster.name, emoji: room.monster.emoji, hp: room.monster.hp, maxHp: room.monster.maxHp },
        results: results(room)
    });
    releaseMembers(room);
    scheduleLeaderboard();
}

function award(p, room, dealt, mult) {
    const gain = Math.round(dealt * baseOf(room).scoreMult * (mult != null ? mult : G.comboMult(p.combo, p.comboTier)));
    p.dmg += dealt;
    p.earned += gain;
    store.addScore(p.id, gain);
}

function monsterAttack(room) {
    if (rooms.get(room.id) !== room || room.status !== 'playing') return;
    const dmg = room.damage;
    const state = {};
    const counters = [];
    let lastCounter = null;

    for (const id of room.ids) {
        const p = players.get(id);
        if (!p || !p.alive) continue;
        let blocked = false;
        const preMult = G.comboMult(p.combo, p.comboTier); // สวนกลับนับคะแนนด้วยคอมโบก่อนโดนตี
        let broke = false;
        if (p.guard) { p.guard = false; blocked = true; } else {
            p.hp = Math.max(0, p.hp - dmg);
            p.hits++;
            broke = p.combo > 0;
            p.combo = 0; p.comboTier = 0; // โดนตี = คอมโบขาด
        }
        if (p.counter > 0 && room.monster.hp > 0) {
            const dealt = Math.min(p.counter, room.monster.hp);
            room.monster.hp -= dealt;
            award(p, room, dealt, preMult);
            counters.push({ id: p.id, name: p.username, cls: p.class, damage: dealt });
            lastCounter = p;
        }
        p.counter = 0;
        if (p.hp <= 0) { p.alive = false; p.guard = false; }
        state[id] = { hp: p.hp, blocked, alive: p.alive, broke };
    }
    room.nextAttackAt = Date.now() + room.speed;
    io.to(room.channel).emit('monster_attack', {
        damage: dmg, nextIn: room.speed, players: state, counters,
        monster: { hp: room.monster.hp, maxHp: room.monster.maxHp }
    });
    for (const id of room.ids) { const p = players.get(id); if (p) emitMe(p); }
    scheduleLeaderboard();

    if (room.monster.hp <= 0) return finishVictory(room, lastCounter);
    if (!room.ids.some(id => players.get(id) && players.get(id).alive)) return finishDefeat(room);
    scheduleAttack(room);
}

function startBattle(room) {
    room.status = 'playing';
    const base = baseOf(room);
    const n = room.ids.length;
    room.monster.maxHp = G.hpForParty(base.maxHp, n);
    room.monster.hp = room.monster.maxHp;
    room.damage = base.damage;
    room.speed = base.speed;
    for (const id of room.ids) {
        const p = players.get(id);
        if (!p) continue;
        p.hp = G.PLAYER_MAX_HP; p.alive = true; p.guard = false; p.counter = 0;
        p.dmg = 0; p.earned = 0; p.bounty = 0; p.ndBonus = 0;
        p.combo = 0; p.comboTier = 0; p.maxCombo = 0; p.hits = 0;
        p.hand = G.rollHand(p.class, [], p.language);
    }
    room.nextAttackAt = Date.now() + room.speed;
    scheduleAttack(room);
    io.to(room.channel).emit('battle_started', {
        roomId: room.id, monster: { ...room.monster, rec: base.rec }, attackMs: room.speed, nextIn: room.speed,
        players: publicRoom(room).players
    });
    for (const id of room.ids) {
        const p = players.get(id);
        if (!p) continue;
        toUser(id).emit('spells', handView(p));
        emitMe(p);
    }
}

/* ======================= ผู้เล่น / การเชื่อมต่อ ======================= */
function kickUser(userId, reason) {
    const p = players.get(userId);
    const sock = p && p.socketId && io.sockets.sockets.get(p.socketId);
    if (sock) { sock.emit('kicked', reason); sock.disconnect(true); }
}

function removePlayer(userId) {
    const p = players.get(userId);
    if (!p || p.online) return;
    try { leaveRoom(userId); } catch (e) { console.error('[error] removePlayer', e); }
    players.delete(userId);
    scheduleLeaderboard();
}

function bucket(socket, key, perSec, burst) {
    const now = Date.now();
    const b = socket.data.rl[key] || (socket.data.rl[key] = { t: now, n: burst });
    b.n = Math.min(burst, b.n + ((now - b.t) / 1000) * perSec);
    b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
}

io.use((socket, next) => {
    const user = store.getSession(socket.handshake.auth && socket.handshake.auth.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    socket.data.rl = {};
    next();
});

io.on('connection', (socket) => {
    const user = store.getUser(socket.data.userId);
    if (!user) { socket.disconnect(true); return; }

    let p = players.get(user.id);
    if (p && p.socketId && p.socketId !== socket.id) {
        const old = io.sockets.sockets.get(p.socketId);
        p.socketId = socket.id; // ตั้งก่อน เพื่อให้ disconnect ของเซสชันเก่าถูกมองข้าม
        if (old) { old.emit('kicked', 'บัญชีนี้เข้าสู่ระบบจากอุปกรณ์อื่น'); old.disconnect(true); }
    }
    if (!p) {
        p = { id: user.id, username: user.username, class: 'Fire', language: 'en', combo: 0, comboTier: 0, maxCombo: 0, hits: 0, ndBonus: 0, roomId: null, hp: G.PLAYER_MAX_HP, alive: true,
              guard: false, counter: 0, dmg: 0, earned: 0, bounty: 0, hand: [], lastCast: 0, socketId: socket.id, online: true, dropTimer: null };
        players.set(user.id, p);
    }
    clearTimeout(p.dropTimer);
    p.dropTimer = null;
    p.socketId = socket.id;
    p.online = true;
    p.username = user.username;
    socket.join('u:' + p.id);

    socket.emit('ready', { me: { id: user.id, username: user.username, score: user.score, wins: user.wins }, config: { ...CONFIG, art: listArt() } });

    const room = p.roomId ? rooms.get(p.roomId) : null;
    if (room) {
        socket.join(room.channel);
        socket.emit('resume', {
            room: publicRoom(room), status: room.status, attackMs: room.speed, language: p.language || 'en',
            nextIn: room.status === 'playing' ? Math.max(0, room.nextAttackAt - Date.now()) : 0,
            spells: handView(p), me: meState(p), score: p.earned
        });
        emitRoom(room);
    } else {
        p.roomId = null;
        setLobby(p);
    }
    scheduleLeaderboard();

    // ห่อ handler ด้วย try/catch + จำกัดอัตราการส่ง — error หรือสแปมจากคนเดียวต้องไม่กระทบคนอื่น
    const on = (event, perSec, burst, handler) => {
        socket.on(event, (...args) => {
            if (!bucket(socket, event, perSec, burst)) return;
            try { handler(...args); } catch (err) {
                console.error(`[error] event "${event}":`, err);
                socket.emit('error_msg', 'เซิร์ฟเวอร์ผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้ง');
            }
        });
    };

    on('join_room', 1, 4, (data) => {
        data = data && typeof data === 'object' ? data : {};
        const cur = p.roomId ? rooms.get(p.roomId) : null;
        if (cur && cur.status === 'playing') return socket.emit('join_error', 'คุณกำลังต่อสู้อยู่');

        const roomId = cleanRoomId(data.roomId) || `SOLO-${p.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
        const cls = typeof data.selectedClass === 'string' && has(G.SPELLS, data.selectedClass) ? data.selectedClass : 'Fire';
        const monsterKey = typeof data.selectedMonster === 'string' && has(G.MONSTERS, data.selectedMonster) ? data.selectedMonster : 'SLIME';
        const language = ['en', 'th', 'mix'].includes(data.selectedLanguage) ? data.selectedLanguage : 'en';

        if (p.roomId && p.roomId !== roomId) leaveRoom(p.id);

        let target = rooms.get(roomId);
        if (!target) {
            if (rooms.size >= MAX_ROOMS) return socket.emit('join_error', 'เซิร์ฟเวอร์มีห้องเต็มแล้ว กรุณาลองใหม่ภายหลัง');
            const m = G.MONSTERS[monsterKey];
            target = {
                id: roomId, channel: `room:${roomId}`, hostId: null, ids: [], status: 'waiting', timer: null,
                damage: m.damage, speed: m.speed, nextAttackAt: 0,
                monster: { key: monsterKey, name: m.name, emoji: m.emoji, hp: m.maxHp, maxHp: m.maxHp }
            };
            rooms.set(roomId, target);
        } else if (target.status !== 'waiting') {
            return socket.emit('join_error', 'ห้องนี้กำลังต่อสู้อยู่ กรุณารอรอบถัดไปหรือเปลี่ยนห้อง');
        }

        if (!target.ids.includes(p.id)) {
            if (target.ids.length >= MAX_PLAYERS_PER_ROOM) return socket.emit('join_error', `ห้องนี้เต็มแล้ว (สูงสุด ${MAX_PLAYERS_PER_ROOM} คน)`);
            target.ids.push(p.id);
        }
        if (!target.hostId) target.hostId = p.id;

        p.class = cls;
        p.language = language;
        p.roomId = roomId;
        p.hp = G.PLAYER_MAX_HP; p.alive = true; p.guard = false; p.counter = 0;
        socket.leave('lobby');
        socket.join(target.channel);
        emitRoom(target);
    });

    on('leave_room', 2, 4, () => leaveRoom(p.id));

    on('start_battle', 2, 3, () => {
        const r = p.roomId ? rooms.get(p.roomId) : null;
        if (!r || r.status !== 'waiting') return;
        if (r.hostId !== p.id) return socket.emit('error_msg', 'เฉพาะหัวหน้าห้องเท่านั้นที่เริ่มการต่อสู้ได้');
        startBattle(r);
    });

    on('cast_spell', 12, 6, (data) => {
        const r = p.roomId ? rooms.get(p.roomId) : null;
        if (!r || r.status !== 'playing' || !p.alive || r.monster.hp <= 0) return;
        const now = Date.now();
        if (now - p.lastCast < MIN_CAST_INTERVAL_MS) return;

        const typed = typeof data?.spell === 'string' ? data.spell.trim().normalize('NFC').toLowerCase().slice(0, 60) : '';
        const spell = typed && p.hand.find(s => s.text.normalize('NFC').toLowerCase() === typed); // ต้องเป็นคาถาที่เซิร์ฟเวอร์แจกให้เท่านั้น
        if (!spell) return;
        p.lastCast = now;

        const dealt = Math.min(G.spellDamage(spell), r.monster.hp);
        r.monster.hp -= dealt;
        const tier = G.wordTier(spell);
        p.combo++; p.comboTier = Math.max(p.comboTier, tier); p.maxCombo = Math.max(p.maxCombo, p.combo);
        award(p, r, dealt);

        // ร่ายสำเร็จ = หน่วงเวลาโจมตีของบอส (ไม่เกิน 1 รอบเต็ม) — ถ้าบอสตายแล้วไม่ต้องสนใจ
        let delayed = 0;
        if (r.monster.hp > 0) {
            const aliveN = r.ids.filter(id => players.get(id) && players.get(id).alive).length;
            const before = r.nextAttackAt;
            r.nextAttackAt = Math.min(now + r.speed, before + G.bossDelayMs(tier, r.speed, aliveN));
            delayed = r.nextAttackAt - before;
            if (delayed > 0) scheduleAttack(r);
        }
        if (spell.kind === 'def') p.guard = true;
        if (spell.kind === 'ctr') p.counter = Math.max(p.counter, G.counterDamage(spell));

        p.hand = G.rollHand(p.class, p.hand.filter(s => s.text !== spell.text), p.language);
        socket.emit('spells', handView(p));
        socket.emit('my_score', p.earned);
        emitMe(p);
        io.to(r.channel).emit('update_battle_state', {
            monster: { hp: r.monster.hp, maxHp: r.monster.maxHp },
            casterId: p.id, caster: p.username, casterClass: p.class, spell: spell.text, kind: spell.kind, damage: dealt,
            tier, combo: p.combo, delayMs: delayed, nextIn: Math.max(0, r.nextAttackAt - now)
        });
        scheduleLeaderboard();
        if (r.monster.hp <= 0) finishVictory(r, p);
    });

    socket.on('disconnect', () => {
        if (p.socketId !== socket.id) return; // เป็นเซสชันเก่าที่ถูกแทนที่แล้ว
        p.online = false;
        const r = p.roomId ? rooms.get(p.roomId) : null;
        if (r) {
            if (r.hostId === p.id) {
                const next = r.ids.find(id => id !== p.id && players.get(id) && players.get(id).online);
                if (next && r.status === 'waiting') r.hostId = next;
            }
            emitRoom(r);
        }
        p.dropTimer = setTimeout(() => removePlayer(p.id), OFFLINE_GRACE_MS);
        scheduleLeaderboard();
    });
});

/* ======================= ความเสถียร ======================= */
setInterval(() => {
    store.cleanup();
    for (const room of [...rooms.values()]) {
        room.ids = room.ids.filter(id => players.has(id));
        if (room.ids.length === 0) destroyRoom(room);
    }
}, 60000).unref();

process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

function shutdown(signal) {
    console.log(`\n${signal} — กำลังบันทึกข้อมูลและปิดเซิร์ฟเวอร์...`);
    for (const room of rooms.values()) clearAttackTimer(room);
    store.flushSync();
    io.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`❌ พอร์ต ${PORT} ถูกใช้งานอยู่ — ปิดโปรแกรมเดิมหรือตั้ง PORT ใหม่`);
    else console.error(err);
    process.exit(1);
});

if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`🔥 KeyMage Server Online (พอร์ต ${PORT})`);
        console.log(`   เปิดในเครื่องนี้ : http://localhost:${PORT}`);
        for (const u of lanUrls(PORT)) console.log(`   เพื่อนในวงเดียวกัน: ${u}`);
        console.log(`   ลิงก์ในอีเมลรีเซ็ตจะใช้ : ${baseUrl}  (ตั้ง BASE_URL ใน .env ถ้าต้องการเปลี่ยน)`);
        console.log(`   อีเมล: ${mailer.enabled ? 'ส่งผ่าน SMTP' : 'ยังไม่ได้ตั้ง SMTP — จะพิมพ์ลิงก์รีเซ็ตในคอนโซลนี้แทน'}`);
    });
}
module.exports = { server, io, store };
