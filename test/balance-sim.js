'use strict';
// จำลองการต่อสู้เพื่อตรวจสมดุล: node test/balance-sim.js
const G = require('../game');

function typist(cps) { return { cps, react: 0.45 }; }

function simulate(monsterKey, party, className = 'Fire', opts = {}) {
    const useCombo = opts.combo !== false; // ปิดคอมโบเพื่อเทียบกับเกมก่อนหน้า
    const base = G.MONSTERS[monsterKey];
    const n = party.length;
    let bossHp = G.hpForParty(base.maxHp, n);
    const dt = 0.02;
    const players = party.map((t) => ({
        t, hp: G.PLAYER_MAX_HP, alive: true, guard: false, ctr: 0,
        hand: G.rollHand(className, []), busyUntil: 0.3, cur: null, combo: 0, ctier: 0, hits: 0
    }));
    const interval = base.speed / 1000;
    let nextAtk = interval;
    let time = 0;
    while (time < 600) {
        time += dt;
        // monster attack
        if (time >= nextAtk) {
            nextAtk += interval;
            for (const p of players) {
                if (!p.alive) continue;
                p.cur = null; p.busyUntil = time + p.t.react; // ล้างที่พิมพ์ค้าง
                if (p.guard) p.guard = false; else { p.hp -= base.damage; p.hits++; p.combo = 0; p.ctier = 0; }
                if (p.ctr > 0) { bossHp -= p.ctr; p.ctr = 0; }
                if (p.hp <= 0) p.alive = false;
            }
            if (bossHp <= 0) return { win: true, time, alive: players.filter(p => p.alive).length, nodmg: players.filter(p => p.alive && p.hits === 0).length };
            if (!players.some(p => p.alive)) return { win: false, time };
        }
        for (const p of players) {
            if (!p.alive) continue;
            if (p.cur) {
                if (time >= p.cur.done) {
                    const s = p.cur.s;
                    const dmg = Math.min(G.spellDamage(s), bossHp);
                    bossHp -= dmg;
                    if (s.kind === 'def') p.guard = true;
                    if (s.kind === 'ctr') p.ctr = G.counterDamage(s);
                    if (useCombo && bossHp > 0) {
                        const tier = G.wordTier(s);
                        p.combo++; p.ctier = Math.max(p.ctier, tier);
                        const aliveN = players.filter(q => q.alive).length;
                        nextAtk = Math.min(time + interval, nextAtk + G.bossDelayMs(tier, base.speed, aliveN) / 1000);
                    }
                    p.hand = G.rollHand(className, p.hand.filter(h => h.text !== s.text));
                    p.cur = null; p.busyUntil = time + p.t.react;
                    if (bossHp <= 0) return { win: true, time, alive: players.filter(q => q.alive).length, nodmg: players.filter(q => q.alive && q.hits === 0).length };
                }
                continue;
            }
            if (time < p.busyUntil) continue;
            // เลือกคาถา
            const left = nextAtk - time;
            const fits = p.hand.filter(s => G.graphemeLength(s.text) / p.t.cps <= left - 0.05);
            let pick = null;
            if (fits.length && Math.random() < 0.35) {
                pick = fits[Math.floor(Math.random() * fits.length)]; // คนจริงไม่ได้เลือกคาถาที่ดีที่สุดทุกครั้ง
            } else if (fits.length) {
                pick = fits.find(s => s.kind === 'def' && !p.guard && p.hp <= 100)
                    || fits.find(s => s.kind === 'ctr' && p.ctr === 0)
                    || fits.filter(s => s.kind === 'atk' || s.kind === 'ult')
                           .sort((a, b) => G.spellDamage(b) / b.text.length - G.spellDamage(a) / a.text.length
                                         || G.spellDamage(b) - G.spellDamage(a))[0]
                    || fits[0];
            }
            if (!pick) { p.busyUntil = nextAtk + 0.01; continue; } // รอให้โดนโจมตีก่อนค่อยพิมพ์
            p.cur = { s: pick, done: time + G.graphemeLength(pick.text) / p.t.cps };
        }
    }
    return { win: false, time };
}

function rate(monsterKey, cpsList, trials = 300, opts = {}) {
    let w = 0, tt = 0, alive = 0;
    for (let i = 0; i < trials; i++) {
        const party = cpsList.map(c => typist(c * (0.85 + Math.random() * 0.3)));
        const r = simulate(monsterKey, party, 'Fire', opts);
        if (r.win) { w++; tt += r.time; alive += r.alive; }
    }
    return { win: w / trials, time: w ? tt / w : 0, alive: w ? alive / w : 0 };
}

function randn() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }
// ผู้เล่นจริงปนกัน: เฉลี่ย 3.0 ตัวอักษร/วินาที (~36 WPM) กระจายตัว
function rateMixed(monsterKey, n, trials = 300, mean = 3.0, sd = 0.9, opts = {}) {
    let w = 0, tt = 0, nd = 0, players = 0;
    for (let i = 0; i < trials; i++) {
        const party = Array.from({ length: n }, () => typist(Math.min(7, Math.max(1.5, mean + sd * randn()))));
        const r = simulate(monsterKey, party, 'Fire', opts);
        if (r.win) { w++; tt += r.time; nd += r.nodmg; players += n; }
    }
    return { win: w / trials, time: w ? tt / w : 0, noDmg: players ? nd / players : 0 };
}
if (require.main !== module) { module.exports = { simulate, rate, rateMixed, typist }; return; }
const profiles = { 'ช้า(2.2)': 2.2, 'ปกติ(3.2)': 3.2, 'เร็ว(4.5)': 4.5, 'โปร(6.5)': 6.5 };
const sizes = [1, 2, 3, 4, 6, 8];
const only = process.argv[2];
for (const key of Object.keys(G.MONSTERS)) {
    if (only && only !== key) continue;
    const m = G.MONSTERS[key];
    console.log(`\n=== ${key} (rec ${m.rec}) hp ${m.maxHp} dmg ${m.damage}/${m.speed}ms ===`);
    console.log('คน      ' + Object.keys(profiles).map(s => s.padEnd(14)).join(''));
    for (const n of sizes) {
        const cells = Object.values(profiles).map(c => {
            const r = rate(key, Array(n).fill(c));
            return `${String(Math.round(r.win * 100)).padStart(3)}% ${r.win ? Math.round(r.time) + 's' : '  -'}`.padEnd(14);
        });
        console.log(String(n).padEnd(8) + cells.join(''));
    }
}
