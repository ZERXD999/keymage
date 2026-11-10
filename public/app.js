(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');
const TOKEN_KEY = 'keymage:token';
const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ใช้ได้ปกติแม้ไม่มี storage */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

/* ---------- ข้อมูลแสดงผล ---------- */
const CLASSES = {
    Fire:        { label: 'อัคคี',          emoji: '🔥', color: '#ff7a45' },
    Water:       { label: 'วารี',           emoji: '💧', color: '#4cc2ff' },
    Wind:        { label: 'วายุ',           emoji: '🌪️', color: '#7ef0cc' },
    Earth:       { label: 'ปฐพี',           emoji: '🪨', color: '#c9a070' },
    Lightning:   { label: 'อัสนี',          emoji: '⚡', color: '#ffe14d' },
    Ice:         { label: 'เหมันต์',        emoji: '❄️', color: '#a8e6ff' },
    Light:       { label: 'แสงศักดิ์สิทธิ์', emoji: '✨', color: '#fff0a8' },
    Dark:        { label: 'ความมืด',        emoji: '🌑', color: '#a58bff' },
    Psychic:     { label: 'พลังจิต',        emoji: '🔮', color: '#ff7be5' },
    Necromancer: { label: 'เนโครแมนเซอร์',   emoji: '☠️', color: '#8fe6a8' },
    Blood:       { label: 'โลหิต',          emoji: '🩸', color: '#ff4d6a' },
    Poison:      { label: 'พิษ',            emoji: '🐍', color: '#b6ff5c' },
    Summoner:    { label: 'อัญเชิญ',        emoji: '🦅', color: '#ffb35c' },
    Hogwarts:    { label: 'จอมเวทย์ Hogwarts', emoji: '🪄', color: '#e8c46a' },
    NeoBlue:       { label: 'Neo Blue-Eyes',   emoji: '🐲', color: '#9fd8ff' },
    ShadowMonarch: { label: 'จักรพรรดิเงา',    emoji: '🗡️', color: '#7a5cff' },
    Ra:            { label: 'มังกรติดปีกแห่งรา', emoji: '☀️', color: '#ffc83d' },
    Slifer:        { label: 'สไลเฟอร์',        emoji: '🐉', color: '#ff5a4d' },
    Obelisk:       { label: 'โอเบลิกส์',        emoji: '👊', color: '#4aa8d8' },
    MegaRayquaza:  { label: 'เมก้าเรย์ควาซา',   emoji: '🐲', color: '#2fd48a' }
};
const KINDS = {
    atk: { icon: '⚔', label: 'โจมตี' }, ult: { icon: '💥', label: 'ไม้ตาย' },
    def: { icon: '🛡', label: 'โล่' }, ctr: { icon: '↩', label: 'สวนกลับ' }
};
const MONSTER_TH = {
    SLIME: 'สไลม์', SKELETON: 'โครงกระดูกนักรบ', OGRE: 'โอเกอร์', NAGA: 'นากา',
    CYCLOPS: 'ไซคลอปส์', SKELETON_MAGE: 'โครงกระดูกเวท', VAMPIRE: 'แวมไพร์',
    FENRIR: 'เฟนรีร์', KRAKEN: 'คราเคน', EXALTED_KNIGHT: 'อัศวินมายา',
    DRAGON: 'มังกรโบราณ', MONSTER_KING: 'ราชันแห่งมอนสเตอร์'
};
const AURA = ['#53e0a0', '#e8e8f8', '#ffb35c', '#7ef0cc', '#a58bff', '#ff8a4c', '#ff719a', '#8fd8ff', '#a88cff', '#d9c7ff', '#ff6b5e', '#ffcc55'];
const monName = (m) => MONSTER_TH[m.key] || m.name;
const SCREENS = ['auth', 'lobby', 'waiting', 'battle'];

const state = {
    screen: 'auth', me: null, cfg: null, classKey: 'Fire', monsterKey: 'SLIME', language: ['en', 'th', 'mix'].includes(store.get('keymage:language')) ? store.get('keymage:language') : 'en',
    lb: { online: 0, list: [] }, filter: '', joining: false, joinTimer: null,
    room: null, monster: null, spells: [], my: { hp: 100, alive: true, guard: false, counter: 0, combo: 0, comboMult: 1, comboCap: 1, maxCombo: 0, hits: 0 },
    party: {}, attackMs: 5000, nextAt: 0, resumed: false, resetToken: '', earned: 0, built: false
};
let socket = null;

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}
function toast(msg, type) {
    const t = el('div', 'toast' + (type === 'err' ? ' err' : ''), msg);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3800);
}
function showScreen(name) {
    state.screen = name;
    SCREENS.forEach((n) => $(n + '-screen').classList.toggle('hidden', n !== name));
    window.scrollTo(0, 0);
    if (name === 'battle') $('spell-input').focus();
}

/* ======================= เสียง (สังเคราะห์ด้วย WebAudio ไม่ต้องมีไฟล์) ======================= */
const audio = { ctx: null, muted: store.get('keymage:muted') === '1' };
function actx() {
    if (audio.muted) return null;
    if (!audio.ctx) { try { audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
}
function tone(freq, dur, type, vol, delay, slide) {
    const c = actx(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
const sfx = {
    cast(kind) { const f = { atk: 520, ult: 330, def: 700, ctr: 440 }[kind] || 520; tone(f, 0.12, 'triangle', 0.07, 0, f * 1.8); },
    hit() { tone(180, 0.16, 'square', 0.05, 0, 60); },
    ult() { tone(260, 0.28, 'sawtooth', 0.07, 0, 90); tone(520, 0.2, 'triangle', 0.05, 0.04, 200); },
    shield() { tone(880, 0.18, 'sine', 0.06); tone(1320, 0.25, 'sine', 0.05, 0.07); },
    ouch() { tone(120, 0.3, 'sawtooth', 0.09, 0, 45); },
    block() { tone(660, 0.2, 'triangle', 0.07, 0, 1200); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, 'triangle', 0.08, i * 0.11)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.06, i * 0.16)); },
    tick() { tone(900, 0.04, 'square', 0.03); }
};
function syncSoundBtn() { $('sound-btn').textContent = audio.muted ? '🔇' : '🔊'; }
$('sound-btn').addEventListener('click', () => { audio.muted = !audio.muted; store.set('keymage:muted', audio.muted ? '1' : '0'); syncSoundBtn(); if (!audio.muted) sfx.shield(); });
syncSoundBtn();

/* ======================= พื้นหลังอนุภาค + ประกายตอนโดนตี ======================= */
const bg = { cv: $('bg'), ctx: null, dots: [], bursts: [], w: 0, h: 0, last: 0 };
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function bgInit() {
    try { bg.ctx = bg.cv.getContext('2d'); } catch (e) { bg.ctx = null; }
    if (!bg.ctx) return;
    const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        bg.w = window.innerWidth; bg.h = window.innerHeight;
        bg.cv.width = bg.w * dpr; bg.cv.height = bg.h * dpr;
        bg.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); window.addEventListener('resize', resize);
    const n = bg.w < 700 ? 34 : 64;
    for (let i = 0; i < n; i++) bg.dots.push({ x: Math.random() * bg.w, y: Math.random() * bg.h, r: Math.random() * 1.6 + .4, v: Math.random() * 12 + 4, a: Math.random() * .6 + .2, t: Math.random() * 6, gold: Math.random() < .3 });
    requestAnimationFrame(bgLoop);
}
function bgLoop(ts) {
    requestAnimationFrame(bgLoop);
    const c = bg.ctx; if (!c || document.hidden) return;
    if (ts - bg.last < 33) return; // ~30fps พอ ประหยัดเครื่อง
    const dt = Math.min(0.1, (ts - bg.last) / 1000); bg.last = ts;
    c.clearRect(0, 0, bg.w, bg.h);
    for (const d of bg.dots) {
        if (!reduceMotion) { d.y -= d.v * dt; d.t += dt; d.x += Math.sin(d.t) * 6 * dt; if (d.y < -5) { d.y = bg.h + 5; d.x = Math.random() * bg.w; } }
        c.globalAlpha = d.a * (0.6 + 0.4 * Math.sin(d.t * 2));
        c.fillStyle = d.gold ? '#ffd470' : '#c8c4ff';
        c.beginPath(); c.arc(d.x, d.y, d.r, 0, 6.283); c.fill();
    }
    for (let i = bg.bursts.length - 1; i >= 0; i--) {
        const p = bg.bursts[i];
        p.life -= dt; if (p.life <= 0) { bg.bursts.splice(i, 1); continue; }
        p.vy += 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.c;
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
}
function burst(x, y, color, n) {
    if (!bg.ctx || reduceMotion) return;
    for (let i = 0; i < n && bg.bursts.length < 160; i++) {
        const a = Math.random() * 6.283, s = 80 + Math.random() * 280;
        bg.bursts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, r: 1.5 + Math.random() * 2.8, c: color, life: .5 + Math.random() * .5, max: 1 });
    }
}
bgInit();

/* ======================= บัญชี / ฟอร์ม ======================= */
async function api(path, body, token) {
    try {
        const r = await fetch('/api' + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: JSON.stringify(body || {})
        });
        const data = await r.json().catch(() => ({}));
        return { status: r.status, ...data };
    } catch (e) { return { ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือ Wi-Fi แล้วลองอีกครั้ง' }; }
}
function authMsg(text, kind) { const m = $('auth-msg'); m.textContent = text || ''; m.className = 'form-msg' + (kind ? ' ' + kind : ''); }
const FORMS = { login: 'login-form', register: 'register-form', forgot: 'forgot-form', reset: 'reset-form' };
function setAuthMode(mode, keepMsg) {
    Object.entries(FORMS).forEach(([k, id]) => $(id).classList.toggle('hidden', k !== mode));
    $('auth-tabs').classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
    $('guest-box').classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
    $('tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('tab-register').setAttribute('aria-selected', String(mode === 'register'));
    if (!keepMsg) authMsg('');
    const first = $(FORMS[mode]).querySelector('input'); if (first && state.screen === 'auth') setTimeout(() => first.focus(), 30);
}
$('guest-btn').addEventListener('click', async () => {
    const b = $('guest-btn'); if (b.disabled) return;
    b.disabled = true; b.classList.add('busy'); authMsg('');
    const r = await api('/guest');
    b.disabled = false; b.classList.remove('busy');
    if (r.ok) onAuthed(r); else authMsg(r.error, 'err');
});
$('tab-login').addEventListener('click', () => setAuthMode('login'));
$('tab-register').addEventListener('click', () => setAuthMode('register'));
$('to-forgot').addEventListener('click', () => { $('fg-email').value = $('li-id').value.includes('@') ? $('li-id').value : ''; setAuthMode('forgot'); });
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => setAuthMode('login')));
document.querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => {
    const i = $(b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password';
}));

function meter(inputId, barId) {
    $(inputId).addEventListener('input', (e) => {
        const v = e.target.value; let s = 0;
        if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^\w\s]/.test(v)) s++;
        const bar = $(barId); bar.style.width = (v ? Math.max(12, s * 20) : 0) + '%';
        bar.style.background = s <= 2 ? 'var(--danger)' : s <= 3 ? '#ffb35c' : 'var(--hp)';
    });
}
meter('rg-pw', 'rg-meter'); meter('rs-pw', 'rs-meter');

async function withBusy(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy'); btn.disabled = true;
    try { await fn(); } finally { btn.classList.remove('busy'); btn.disabled = false; }
}
function onAuthed(r) {
    store.set(TOKEN_KEY, r.token);
    authMsg('');
    connect(r.token);
}
$('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(e.target, async () => {
        const r = await api('/login', { identifier: $('li-id').value, password: $('li-pw').value });
        if (r.ok) { $('li-pw').value = ''; onAuthed(r); } else authMsg(r.error, 'err');
    });
});
$('register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(e.target, async () => {
        if ($('rg-pw').value !== $('rg-pw2').value) return authMsg('รหัสผ่านสองช่องไม่ตรงกัน', 'err');
        const r = await api('/register', { email: $('rg-email').value, username: $('rg-name').value, password: $('rg-pw').value });
        if (r.ok) { $('rg-pw').value = $('rg-pw2').value = ''; onAuthed(r); } else authMsg(r.error, 'err');
    });
});
$('forgot-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(e.target, async () => {
        const r = await api('/forgot', { email: $('fg-email').value });
        authMsg(r.ok ? r.message : r.error, r.ok ? 'ok' : 'err');
    });
});
$('reset-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(e.target, async () => {
        if ($('rs-pw').value !== $('rs-pw2').value) return authMsg('รหัสผ่านสองช่องไม่ตรงกัน', 'err');
        const r = await api('/reset', { token: state.resetToken, password: $('rs-pw').value });
        if (r.ok) {
            state.resetToken = ''; $('rs-pw').value = $('rs-pw2').value = '';
            setAuthMode('login'); authMsg('ตั้งรหัสผ่านใหม่เรียบร้อย เข้าสู่ระบบด้วยรหัสใหม่ได้เลย', 'ok');
        } else authMsg(r.error, 'err');
    });
});
$('logout-btn').addEventListener('click', async () => {
    const t = store.get(TOKEN_KEY);
    store.del(TOKEN_KEY);
    if (t) api('/logout', {}, t);
    resetToAuth('');
});
function resetToAuth(msg, kind) {
    if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
    $('conn').classList.add('hidden');
    $('result').classList.add('hidden');
    state.me = null; state.room = null; state.joining = false;
    showScreen('auth'); setAuthMode('login', true); authMsg(msg || '', kind);
}

/* ======================= Socket ======================= */
function connect(token) {
    if (socket) { socket.removeAllListeners(); socket.disconnect(); }
    socket = io({ auth: { token }, reconnectionDelayMax: 3000 });
    bindSocket(socket);
}
const setConn = (ok) => $('conn').classList.toggle('hidden', ok);

function bindSocket(s) {
    s.on('connect', () => setConn(true));
    s.on('disconnect', (reason) => { if (reason !== 'io client disconnect') setConn(false); });
    s.on('connect_error', (err) => {
        if (err && err.message === 'unauthorized') { store.del(TOKEN_KEY); resetToAuth('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', 'err'); } else setConn(false);
    });
    s.on('kicked', (reason) => {
        if (/รหัสผ่าน/.test(reason)) store.del(TOKEN_KEY);
        resetToAuth(reason, 'err');
    });
    s.on('error_msg', (m) => toast(m, 'err'));

    s.on('ready', (d) => {
        state.me = d.me; state.cfg = d.config; state.resumed = false;
        $('my-name').textContent = d.me.username;
        $('my-avatar').textContent = [...d.me.username][0].toUpperCase();
        setProfile(d.me);
        buildLobby();
        if (state.screen === 'auth' || state.screen === 'lobby') showScreen('lobby');
        else setTimeout(() => { // กำลังอยู่ในห้องก่อนหลุด: ถ้าเซิร์ฟเวอร์ไม่ส่ง resume แปลว่าห้องจบไปแล้ว
            if (!state.resumed && (state.screen === 'waiting' || state.screen === 'battle')) { state.room = null; $('result').classList.add('hidden'); showScreen('lobby'); toast('ห้องที่คุณอยู่ปิดไปแล้ว กลับสู่ล็อบบี้'); }
        }, 700);
    });
    s.on('profile', setProfile);
    s.on('update_leaderboard', (d) => { state.lb = d; renderLeaderboard(); });
    s.on('join_error', (m) => { resetJoining(); toast(m, 'err'); });
    s.on('waiting_room_update', onRoomUpdate);
    s.on('resume', onResume);
    s.on('battle_started', onBattleStarted);
    s.on('spells', (sp) => { state.spells = sp; renderSpells(); });
    s.on('my_score', (n) => { state.earned = n; $('battle-score').textContent = fmt(n); });
    s.on('me_state', (m) => {
        const prev = state.my.combo || 0;
        state.my = m; renderMe();
        if (prev >= 3 && m.combo === 0) comboBreak(prev);
        else if (m.combo > prev) comboUp(m.combo);
    });
    s.on('update_battle_state', onBattleState);
    s.on('monster_attack', onMonsterAttack);
    s.on('monster_dead', (d) => showResult('win', d));
    s.on('battle_lost', (d) => showResult('lose', d));
}
function setProfile(p) {
    if (p.score != null) $('my-total').textContent = fmt(p.score);
    if (p.wins != null) $('my-wins').textContent = fmt(p.wins);
}


/* ---------- รูปภาพ (ถ้าไม่มีไฟล์ จะใช้อิโมจิแทนโดยอัตโนมัติ) ---------- */
const artMap = () => (state.cfg && state.cfg.art) || { mage: {}, avatar: {}, monster: {} };
function emojiOf(key) { return (CLASSES[key] || CLASSES.Fire).emoji; }
function withFallback(img, fallbackNode) { img.addEventListener('error', () => img.replaceWith(fallbackNode)); return img; }
function artImg(src, cls, alt) { const i = document.createElement('img'); i.src = src; i.className = cls; i.alt = alt || ''; i.loading = 'lazy'; i.decoding = 'async'; i.draggable = false; return i; }
// วงกลมเล็กของสายอาชีพ (รายชื่อสมาชิก / ผลสรุป)
function classAvatar(key, cls) {
    const em = el('span', 'em ' + (cls || ''), emojiOf(key));
    const src = artMap().avatar[key] || artMap().mage[key];
    return src ? withFallback(artImg(src, 'av ' + (cls || ''), ''), em) : em;
}
// รูปมอนสเตอร์ (ไม่มีไฟล์ = อิโมจิ)
function monsterArt(key, emoji, cls) {
    const em = el('span', cls || 'em', emoji);
    const src = artMap().monster[key];
    return src ? withFallback(artImg(src, 'monster-art ' + (cls || ''), ''), em) : em;
}
function setMonsterArt(node, key, emoji) { node.replaceChildren(monsterArt(key, emoji, 'em')); }

/* ======================= ล็อบบี้ ======================= */
function pick(container, btn) { container.querySelectorAll('.opt').forEach((b) => b.setAttribute('aria-pressed', String(b === btn))); }

const CLASS_TIERS = [
    { id: 'easy', keys: ['Fire', 'Ice', 'Light', 'Wind'] },
    { id: 'medium', keys: ['Water', 'Earth', 'Lightning', 'Dark', 'Poison'] },
    { id: 'hard', keys: ['Psychic', 'Necromancer', 'Blood', 'Summoner'] },
    { id: 'special', keys: ['Hogwarts', 'NeoBlue', 'ShadowMonarch', 'Ra', 'Slifer', 'Obelisk', 'MegaRayquaza'] }
];
const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
const graphemes = (value) => graphemeSegmenter ? Array.from(graphemeSegmenter.segment(String(value || '').normalize('NFC'))).length : Array.from(String(value || '')).length;
const splitGraphemes = (value) => graphemeSegmenter ? Array.from(graphemeSegmenter.segment(String(value || '').normalize('NFC')), part => part.segment) : Array.from(String(value || '').normalize('NFC'));
function selectedSpellPool() {
    const en = state.cfg.spells[state.classKey] || [];
    const th = (state.cfg.spellsThai && state.cfg.spellsThai[state.classKey]) || [];
    return state.language === 'th' ? th : state.language === 'mix' ? [...en, ...th] : en;
}
function renderSpellPreview() {
    const box = $('spell-preview'); box.replaceChildren();
    const list = selectedSpellPool().slice().sort((a, b) => graphemes(a.text) - graphemes(b.text));
    if (!list.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    list.forEach((sp) => {
        const dmg = Math.round((Number.isFinite(sp.powerLength) ? sp.powerLength : graphemes(sp.text)) * 10 * state.cfg.kinds[sp.kind].mult);
        const c = el('span', 'chip k-' + sp.kind);
        c.append(sp.text + ' ', el('small', null, `${KINDS[sp.kind].icon} ${dmg}`));
        box.appendChild(c);
    });
}
function renderLanguagePicker() {
    $('language-list').querySelectorAll('[data-language]').forEach((b) => {
        const selected = b.dataset.language === state.language;
        b.setAttribute('aria-pressed', String(selected));
    });
}

function renderComboHelp() {
    const c = state.cfg.combo; if (!c) return;
    const body = $('combo-help-body'); body.replaceChildren();
    body.appendChild(el('p', null, 'ร่ายคาถาติดกันโดยไม่โดนตี คอมโบจะเพิ่มทีละ 1 ตัวคูณคะแนนค่อย ๆ ขึ้น (+' + Math.round(c.step * 100) + '% ต่อคอมโบ) จนถึงเพดานของ "คำที่ยากที่สุดที่คุณร่ายในสายคอมโบนี้" และทุกครั้งที่ร่ายสำเร็จ เวลาโจมตีของบอสจะถูกหน่วงออกไป'));
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>ระดับคำ</th><th>เพดานคะแนน</th><th>หน่วงเวลาบอส</th></tr></thead>';
    const tb = document.createElement('tbody');
    Object.values(c.tiers).forEach((x, i) => {
        const tr = document.createElement('tr');
        [`${'◆'.repeat(i + 1)} ${x.name}`, `×${x.cap}`, x.delay >= 1 ? 'รีเซ็ตเวลาบอสเต็มรอบ' : `+${Math.round(x.delay * 100)}% ของรอบโจมตี`].forEach((txt) => tr.appendChild(el('td', null, txt)));
        tb.appendChild(tr);
    });
    t.appendChild(tb); body.appendChild(t);
    body.appendChild(el('p', null, `โดนตีเมื่อไรคอมโบขาด (โล่กันได้ไม่ขาด) · เล่นปาร์ตี้ เวลาที่หน่วงจะหารตามจำนวนคนที่ยังสู้อยู่ · ชนะโดยไม่เสียพลังชีวิตเลย = NO DAMAGE ได้โบนัส +${Math.round(c.noDamageBonus * 100)}% ของโบนัสชัยชนะ`));
}
function buildLobby() {
    if (state.cfg) renderComboHelp();
    if (state.built) { renderLeaderboard(); return; }
    state.built = true;
    const classRoot = $('class-list');
    CLASS_TIERS.forEach((tier) => {
        const host = $('class-' + tier.id);
        tier.keys.filter((key) => state.cfg.classes.includes(key)).forEach((key) => {
            const c = CLASSES[key] || { label: key, emoji: '✨', color: '#f5c451' };
            const b = el('button', 'class-option'); b.type = 'button';
            b.style.setProperty('--c', c.color); b.setAttribute('aria-pressed', String(key === state.classKey));
            const cardSrc = artMap().mage[key];
            b.setAttribute('aria-label', c.label);
            if (cardSrc) {
                b.classList.add('has-card');
                const fb = el('span', 'em', c.emoji);
                b.append(withFallback(artImg(cardSrc, 'card-img', c.label), fb), el('span', 'class-name', c.label));
                host.classList.add('cards');
            } else b.append(el('span', 'em', c.emoji), el('span', 'class-name', c.label));
            b.addEventListener('click', () => {
                state.classKey = key;
                classRoot.querySelectorAll('.class-option').forEach((node) => node.setAttribute('aria-pressed', String(node === b)));
                renderSpellPreview();
            });
            host.appendChild(b);
        });
    });
    $('language-list').querySelectorAll('[data-language]').forEach((b) => b.addEventListener('click', () => {
        state.language = b.dataset.language;
        store.set('keymage:language', state.language);
        renderLanguagePicker();
        renderSpellPreview();
    }));
    renderLanguagePicker();
    renderSpellPreview();

    const mbox = $('monster-list');
    state.cfg.monsters.forEach((m) => {
        const b = el('button', 'monster-card'); b.type = 'button';
        b.style.setProperty('--c', AURA[m.tier - 1] || '#ff6b7a'); b.setAttribute('aria-pressed', String(m.key === state.monsterKey));
        b.append(monsterArt(m.key, m.emoji, 'monster-em'), el('span', 'monster-name', monName(m)));
        b.append(el('span', 'monster-stat', `พลังชีวิต ${fmt(m.maxHp)}`));
        b.append(el('span', 'monster-stat', `โจมตี ${m.damage} ทุก ${(m.speedMs / 1000).toFixed(1).replace(/\.0$/, '')} วินาที`));
        if (m.tier >= 11) b.append(el('span', 'monster-tag', 'ระดับบอส'));
        b.addEventListener('click', () => {
            state.monsterKey = m.key;
            mbox.querySelectorAll('.monster-card').forEach((node) => node.setAttribute('aria-pressed', String(node === b)));
        });
        mbox.appendChild(b);
    });
    renderLeaderboard();
}
function renderLeaderboard() {
    const ul = $('lb-list'); ul.replaceChildren();
    $('online-count').textContent = `ออนไลน์ ${state.lb.online} คน`;
    const q = state.filter.trim().toLowerCase();
    const rows = state.lb.list.map((p, i) => ({ ...p, rank: i + 1 })).filter((p) => !q || p.username.toLowerCase().includes(q));
    if (!rows.length) { ul.appendChild(el('li', 'empty', q ? 'ไม่พบชื่อนี้' : 'ยังไม่มีใครทำคะแนน — เป็นคนแรกเลย!')); return; }
    rows.forEach((p) => {
        const li = el('li', (p.rank <= 3 ? 'r' + p.rank : '') + (state.me && p.id === state.me.id ? ' me' : ''));
        const nm = el('span', 'nm'); if (p.on) nm.appendChild(el('i')); nm.append(p.username);
        li.append(el('span', 'rk', ['🥇', '🥈', '🥉'][p.rank - 1] || p.rank), nm, el('span', 'sc', fmt(p.score)));
        ul.appendChild(li);
    });
}
$('lb-search').addEventListener('input', (e) => { state.filter = e.target.value; renderLeaderboard(); });

function resetJoining() { state.joining = false; clearTimeout(state.joinTimer); $('join-btn').disabled = false; }
$('join-btn').addEventListener('click', () => {
    if (state.joining || !socket) return;
    state.joining = true; $('join-btn').disabled = true;
    state.joinTimer = setTimeout(resetJoining, 4000);
    actx();
    socket.emit('join_room', { roomId: $('room-input').value, selectedClass: state.classKey, selectedMonster: state.monsterKey, selectedLanguage: state.language });
});
$('room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });

/* ======================= ห้องรอ ======================= */
function renderWaiting() {
    const r = state.room, isHost = r.hostId === state.me.id, n = r.players.length;
    $('wait-room-id').textContent = r.id;
    setMonsterArt($('wait-monster-em'), r.monster.key, r.monster.emoji);
    $('wait-monster-name').textContent = monName(r.monster);
    $('wait-monster-stat').textContent = `พลังชีวิต ${fmt(r.monster.maxHp)} (ปรับตามปาร์ตี้ ${n} คน) · แนะนำ ${r.monster.rec} คน`;
    $('wait-count').textContent = `${n} / ${r.maxPlayers} คน`;

    const note = $('wait-notice'); note.classList.remove('hidden', 'warn', 'good');
    if (n < r.monster.rec) { note.classList.add('warn'); note.textContent = `ปาร์ตี้เล็กกว่าที่แนะนำ (${r.monster.rec} คน) — จะค่อนข้างยาก ชวนเพื่อนเพิ่มหรือเลือกมอนสเตอร์ที่เบาลง`; }
    else if (r.monster.key !== state.monsterKey) { note.classList.add('good'); note.textContent = 'ห้องนี้ถูกตั้งเป้าหมายไว้แล้วโดยผู้สร้างห้อง'; }
    else note.classList.add('hidden');

    const ul = $('wait-players'); ul.replaceChildren();
    r.players.forEach((p) => {
        const li = el('li', p.online === false ? 'off' : '');
        li.append(classAvatar(p.class), el('span', 'nm', p.username));
        if (p.id === r.hostId) li.append(el('span', 'badge', 'หัวหน้าห้อง'));
        if (p.id === state.me.id) li.append(el('span', 'you', 'คุณ'));
        ul.appendChild(li);
    });
    $('start-btn').disabled = !isHost;
    $('start-hint').textContent = isHost ? 'เมื่อทุกคนพร้อมแล้ว กดเริ่มได้เลย' : 'รอหัวหน้าห้องเริ่มการต่อสู้';
}
function onRoomUpdate(room) {
    state.room = room;
    if (!room.players.some((p) => p.id === state.me.id)) return;
    resetJoining();
    if (state.screen === 'lobby') showScreen('waiting');
    if (state.screen === 'waiting') renderWaiting();
    if (state.screen === 'battle') renderParty();
}
$('leave-btn').addEventListener('click', () => { socket.emit('leave_room'); state.room = null; showScreen('lobby'); });
$('start-btn').addEventListener('click', () => { actx(); socket.emit('start_battle'); });
$('copy-btn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.room.id); toast('คัดลอกรหัสห้องแล้ว'); } catch (e) { toast('คัดลอกไม่สำเร็จ ลองเลือกรหัสแล้วคัดลอกเอง', 'err'); }
});

/* ======================= ต่อสู้ ======================= */
const input = $('spell-input');
function renderBossHp() {
    const m = state.monster, pct = Math.max(0, (m.hp / m.maxHp) * 100) + '%';
    $('monster-hp-fill').style.width = pct; $('monster-hp-ghost').style.width = pct;
    $('monster-hp-text').textContent = `${fmt(Math.max(0, m.hp))} / ${fmt(m.maxHp)}`;
}
function renderMe() {
    const m = state.my;
    $('my-hp-fill').style.width = Math.max(0, m.hp) + '%';
    $('my-hp-text').textContent = Math.max(0, m.hp);
    $('my-hp-bar').classList.toggle('low', m.hp <= 30);
    const row = $('status-row'); row.replaceChildren();
    if (m.guard) row.appendChild(el('span', 'badge-s sh', '🛡 โล่พร้อม'));
    if (m.counter > 0) row.appendChild(el('span', 'badge-s ct', `↩ สวนกลับ ${fmt(m.counter)}`));
    $('fallen').classList.toggle('hidden', m.alive !== false);
    renderCombo();
    input.disabled = m.alive === false;
    if (m.alive === false) { input.value = ''; input.placeholder = 'คุณล้มแล้ว'; input.blur(); } else input.placeholder = 'พิมพ์คาถาตรงนี้';
}
function renderParty() {
    const box = $('party'); box.replaceChildren();
    ((state.room && state.room.players) || []).filter((p) => p.id !== state.me.id).forEach((p) => {
        const st = state.party[p.id] || {};
        const hp = st.hp != null ? st.hp : 100, alive = st.alive != null ? st.alive : p.alive !== false;
        const m = el('div', 'mate' + (alive ? '' : ' down') + (st.blocked ? ' shielded' : ''));
        const bar = el('div', 'bar' + (hp <= 30 ? ' low' : '')); const fill = document.createElement('i'); fill.style.width = hp + '%'; bar.appendChild(fill);
        m.append(el('span', null, p.username), bar); box.appendChild(m);
    });
}
function renderSpells() {
    const box = $('active-skills'); box.replaceChildren();
    state.spells.forEach((s) => {
        const baseLength = Number.isFinite(s.powerLength) ? s.powerLength : graphemes(s.text);
        const dmg = Math.round(baseLength * 10 * state.cfg.kinds[s.kind].mult);
        const counter = Math.round(baseLength * 10 * state.cfg.kinds.ctr.counterMult);
        const card = el('div', 'spell k-' + s.kind);
        card.append(el('span', 'tagk', `${KINDS[s.kind].icon} ${KINDS[s.kind].label}`));
        const tier = s.tier || 1, ct = state.cfg.combo && state.cfg.combo.tiers[tier];
        if (ct) { const tg = el('span', 'tier t' + tier, `${'◆'.repeat(tier)} ${ct.name}`); tg.title = `หน่วงเวลาบอส ${Math.round(ct.delay * 100)}% · เพดานคะแนนคอมโบ ×${ct.cap}`; card.append(tg); }
        const word = el('span', 'word'); splitGraphemes(s.text).forEach((ch) => word.appendChild(el('span', null, ch)));
        const base = s.kind === 'def' ? `โล่ + ดาเมจ ${dmg}` : s.kind === 'ctr' ? `ดาเมจ ${dmg} + สวนกลับ ${counter}` : `ดาเมจ ${dmg}`;
        const hold = ct ? ` · ⏱ +${(ct.delay * state.attackMs / aliveCount() / 1000).toFixed(1)} วิ` : '';
        card.append(word, el('span', 'meta', base + hold));
        box.appendChild(card);
    });
    updateProgress();
}
function updateProgress() {
    const raw = input.value.normalize('NFC').toLowerCase().replace(/^\s+/, '');
    const typedCount = graphemes(raw);
    const cards = [...$('active-skills').children]; let any = false;
    state.spells.forEach((s, i) => {
        const card = cards[i]; if (!card) return;
        const ok = raw.length > 0 && s.text.normalize('NFC').toLowerCase().startsWith(raw); any = any || ok;
        card.classList.toggle('on', ok); card.classList.toggle('off', raw.length > 0 && !ok);
        [...card.querySelector('.word').children].forEach((ch, idx) => ch.classList.toggle('done', ok && idx < typedCount));
    });
    const wasWrong = input.classList.contains('wrong');
    input.classList.toggle('wrong', raw.length > 0 && !any);
    if (!wasWrong && input.classList.contains('wrong')) sfx.tick();
    const hasThai = /[\u0E00-\u0E7F]/.test(input.value);
    const hasLatin = /[a-z]/i.test(input.value);
    $('kbd-hint').textContent = state.language === 'th' && hasLatin
        ? '⌨ สลับคีย์บอร์ดเป็นภาษาไทย (TH) ก่อนพิมพ์คาถา'
        : state.language === 'en' && hasThai
            ? '⌨ สลับคีย์บอร์ดเป็นภาษาอังกฤษ (EN) ก่อนพิมพ์คาถา'
            : state.language === 'mix'
                ? 'โหมดผสม: สลับแป้นพิมพ์ TH / EN ให้ตรงกับภาษาของคาถา'
                : '';
}

/* ---------- คอมโบ ---------- */
function aliveCount() {
    const others = ((state.room && state.room.players) || []).filter((p) => p.id !== state.me.id)
        .filter((p) => { const st = state.party[p.id]; return st && st.alive != null ? st.alive : p.alive !== false; }).length;
    return Math.max(1, (state.my.alive === false ? 0 : 1) + others);
}
function renderCombo() {
    const m = state.my, box = $('combo'); if (!box) return;
    const n = m.combo || 0, tier = m.comboCap >= 1.6 ? 3 : m.comboCap >= 1.4 ? 2 : m.comboCap > 1 ? 1 : 0;
    box.className = 'combo' + (n > 0 ? ' live t' + tier : '');
    $('combo-n').textContent = n;
    $('combo-mult').textContent = '×' + Number(m.comboMult || 1).toFixed(2);
    $('combo-cap').textContent = tier ? `(สูงสุดตอนนี้ ×${Number(m.comboCap).toFixed(1)})` : '';
    const span = (m.comboCap || 1) - 1;
    $('combo-fill').style.width = (span > 0 ? Math.min(100, ((m.comboMult - 1) / span) * 100) : 0) + '%';
    if (n === 0) setComboNote('ร่ายคาถาต่อเนื่องโดยไม่โดนตี เพื่อสะสมคอมโบ', '');
    else if (!tier) setComboNote('', '');
    else setComboNote(`คำยากขึ้น = เพดานคะแนนสูงขึ้น และหน่วงบอสได้นานขึ้น`, 'good');
}
function setComboNote(text, cls) { const n = $('combo-note'); n.textContent = text; n.className = 'combo-note' + (cls ? ' ' + cls : ''); }
function comboPop(text, cls) { const p = $('combo-pop'); p.textContent = text; p.className = 'combo-pop ' + (cls || ''); void p.offsetWidth; p.classList.add('show'); }
function comboUp(n) {
    const b = $('combo-n'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    if (n > 0 && n % 5 === 0) { comboPop(`🔥 COMBO ×${n}`, ''); sfx.win(); }
}
function comboBreak(was) {
    const box = $('combo'); retrigger(box, 'broke'); comboPop(`💔 คอมโบขาด (${was})`, 'break'); setComboNote('โดนตีแล้ว คอมโบเริ่มใหม่ — โล่ช่วยกันคอมโบไว้ได้', 'bad');
    setTimeout(() => box.classList.remove('broke'), 400);
}
function showBossDelay(d) {
    const b = $('atk-bonus'), reset = d.nextIn >= state.attackMs - 80;
    b.textContent = reset ? '⏱ เวลาบอสรีเซ็ต!' : `⏱ +${(d.delayMs / 1000).toFixed(1)} วิ`;
    b.className = 'atk-bonus'; void b.offsetWidth; b.classList.add('show');
    const t = $('atk-timer'); t.classList.add('delayed'); setTimeout(() => t.classList.remove('delayed'), 500);
}
function onBattleStarted(d) {
    state.monster = { ...d.monster }; state.party = {}; state.spells = []; state.earned = 0;
    state.my = { hp: 100, alive: true, guard: false, counter: 0, combo: 0, comboMult: 1, comboCap: 1, maxCombo: 0, hits: 0 };
    if (state.room && d.players) state.room.players = d.players;
    setupBattleView(d.nextIn, d.attackMs);
    $('battle-score').textContent = '0';
    input.value = '';
    $('result').classList.add('hidden');
    renderSpells(); showScreen('battle'); sfx.shield();
}
function setupBattleView(nextIn, attackMs) {
    state.attackMs = attackMs; state.nextAt = performance.now() + nextIn;
    $('current-room').textContent = state.room ? state.room.id : '';
    $('monster-name').textContent = monName(state.monster);
    $('monster-img').replaceChildren(monsterArt(state.monster.key, state.monster.emoji, 'sprite-em'));
    const tier = (state.cfg.monsters.find((m) => m.key === state.monster.key) || {}).tier || 1;
    $('sprite-wrap').style.setProperty('--aura', AURA[tier - 1]);
    $('fx').replaceChildren();
    renderBossHp(); renderMe(); renderParty();
}
function onResume(d) {
    state.resumed = true;
    if (['en', 'th', 'mix'].includes(d.language)) { state.language = d.language; store.set('keymage:language', state.language); if (state.built) renderLanguagePicker(); }
    state.room = d.room; state.my = d.me; state.earned = d.score || 0;
    if (d.status === 'playing') {
        state.monster = { ...d.room.monster }; state.spells = d.spells || []; state.party = {};
        setupBattleView(d.nextIn, d.attackMs);
        $('battle-score').textContent = fmt(state.earned); input.value = '';
        renderSpells(); showScreen('battle'); toast('กลับเข้าสู่การต่อสู้แล้ว');
    } else { showScreen('waiting'); renderWaiting(); toast('กลับเข้าห้องเดิมแล้ว'); }
}
function spawnDamage(opts) {
    const fx = $('fx'); if (fx.children.length > 14) fx.firstChild.remove();
    const d = el('div', 'dmg' + (opts.big ? ' big' : '') + (opts.ctr ? ' ctr' : ''));
    d.style.setProperty('--c', opts.color); d.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
    d.append(el('div', null, (opts.ctr ? '↩ -' : '-') + fmt(opts.damage)), el('div', 'who', opts.who));
    fx.appendChild(d); setTimeout(() => d.remove(), 1000);
    const r = $('sprite-wrap').getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, opts.color, opts.big ? 28 : 14);
}
function retrigger(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

input.addEventListener('input', () => {
    const typed = input.value.normalize('NFC').toLowerCase().trim();
    const sp = typed && state.spells.find((s) => s.text.normalize('NFC').toLowerCase() === typed);
    if (sp && socket) { socket.emit('cast_spell', { spell: sp.text }); sfx.cast(sp.kind); input.value = ''; }
    updateProgress();
});
input.addEventListener('paste', (e) => e.preventDefault()); // เกมพิมพ์ ต้องพิมพ์เองเท่านั้น
input.addEventListener('drop', (e) => e.preventDefault());
$('battle-screen').addEventListener('pointerdown', (e) => { if (!input.disabled && !e.target.closest('button')) setTimeout(() => input.focus(), 0); });

function onBattleState(d) {
    state.monster = { ...state.monster, ...d.monster };
    renderBossHp();
    if (d.nextIn != null) state.nextAt = performance.now() + d.nextIn;
    if (d.casterId === state.me.id && d.delayMs > 40) showBossDelay(d);
    const big = d.kind === 'ult';
    spawnDamage({ damage: d.damage, who: d.caster, color: (CLASSES[d.casterClass] || CLASSES.Fire).color, big });
    retrigger($('sprite-wrap'), 'hit');
    if (d.casterId !== state.me.id) sfx.hit(); else if (big) sfx.ult(); else if (d.kind === 'def') sfx.shield();
}
function onMonsterAttack(d) {
    state.monster = { ...state.monster, ...d.monster }; renderBossHp();
    state.party = d.players; renderParty();
    state.nextAt = performance.now() + d.nextIn;
    const mine = d.players[state.me.id];
    input.value = ''; updateProgress();
    retrigger($('stage'), 'shake');
    const v = $('vignette');
    v.classList.toggle('block', !!(mine && mine.blocked));
    retrigger(v, 'flash');
    if (mine && mine.blocked) { sfx.block(); if (state.my.combo > 0) setComboNote('🛡 โล่กันไว้ — คอมโบไม่ขาด', 'good'); } else if (mine) sfx.ouch();
    (d.counters || []).forEach((c, i) => setTimeout(() => {
        spawnDamage({ damage: c.damage, who: c.name, color: '#c58bff', big: true, ctr: true }); sfx.ult();
    }, 180 + i * 120));
}

// แถบนับถอยหลังการโจมตีของมอนสเตอร์ (ช่วยวางจังหวะว่าพิมพ์ทันไหม)
function tickTimer() {
    requestAnimationFrame(tickTimer);
    if (state.screen !== 'battle' || !state.attackMs) return;
    const left = Math.max(0, state.nextAt - performance.now());
    $('atk-fill').style.width = (left / state.attackMs * 100) + '%';
    $('atk-label').textContent = `โจมตีใน ${(left / 1000).toFixed(1)} วิ`;
    $('atk-timer').classList.toggle('soon', left < 1200);
}
requestAnimationFrame(tickTimer);

/* ---------- ผลการต่อสู้ ---------- */
function showResult(kind, d) {
    input.disabled = true; input.blur();
    const win = kind === 'win';
    $('result-em').replaceChildren(monsterArt(d.monster.key, d.monster.emoji, 'em'));
    const t = $('result-title'); t.textContent = win ? 'ปราบสำเร็จ!' : 'พ่ายแพ้…'; t.className = win ? 'win' : 'lose';
    $('result-sub').textContent = win
        ? `${d.killer ? d.killer + ' ปิดฉาก ' : 'ปราบ '}${monName(d.monster)}`
        : `ทั้งปาร์ตี้ล้มลง — ${monName(d.monster)} เหลือพลังชีวิต ${d.monster.maxHp ? Math.round((d.monster.hp / d.monster.maxHp) * 100) : 0}%`;
    const ol = $('result-list'); ol.replaceChildren();
    let mine = 0;
    (d.results || []).forEach((r, i) => {
        const me = r.id === state.me.id; if (me) mine = r.earned || 0;
        const li = el('li', me ? 'me' : '');
        const nameCell = el('span', 'rname'); nameCell.append(classAvatar(r.cls, 'sm'), `${r.username}${r.alive ? '' : ' 💀'}`);
        const tags = []; if (r.noDamage && win) tags.push(`✨ NO DAMAGE +${fmt(r.nd || 0)}`); if (r.maxCombo > 1) tags.push(`🔥 คอมโบสูงสุด ${r.maxCombo}`);
        if (tags.length) nameCell.appendChild(el('span', 'tags', tags.join(' · ')));
        li.append(el('span', 'rk', i + 1), nameCell, el('span', 'dm', fmt(r.damage)), el('span', 'ea', '+' + fmt(r.earned || 0)));
        ol.appendChild(li);
    });
    $('result-total').textContent = mine ? `คุณได้คะแนน +${fmt(mine)}${win ? ' (รวมโบนัสชัยชนะ)' : ''}` : '';
    $('result').classList.remove('hidden'); $('result-btn').focus();
    (win ? sfx.win : sfx.lose)();
    if (win) { const r = $('stage').getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, '#ffd470', 60); }
}
$('result-btn').addEventListener('click', () => { $('result').classList.add('hidden'); state.room = null; showScreen('lobby'); });
// ถ้าล้มก่อนจบ กดกลับล็อบบี้ได้เลย
(() => {
    const b = el('button', 'btn btn-quiet', 'ออกไปล็อบบี้'); b.type = 'button'; b.style.cssText = 'padding:0 8px;margin-left:8px;font-size:13px;color:#2a0006;text-decoration:underline;';
    b.addEventListener('click', () => { if (socket) socket.emit('leave_room'); state.room = null; showScreen('lobby'); });
    $('fallen').appendChild(b);
})();

/* ======================= เริ่มต้น ======================= */
(async function boot() {
    const url = new URL(location.href);
    if (url.pathname === '/reset') {
        const token = url.searchParams.get('token') || '';
        history.replaceState(null, '', '/');
        showScreen('auth');
        const r = token ? await api('/reset/check', { token }) : { ok: false };
        if (r.ok) { state.resetToken = token; setAuthMode('reset'); } else { setAuthMode('login', true); authMsg('ลิงก์รีเซ็ตรหัสผ่านหมดอายุหรือใช้ไปแล้ว กรุณากด "ลืมรหัสผ่าน" เพื่อขอลิงก์ใหม่', 'err'); }
        return;
    }
    const token = store.get(TOKEN_KEY);
    showScreen('auth'); setAuthMode('login', true);
    if (token) { authMsg('กำลังเข้าสู่ระบบอัตโนมัติ…'); connect(token); }
})();
})();
