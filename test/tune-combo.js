'use strict';
// ปรับ HP มอนสเตอร์ให้ "มีคอมโบ" แล้วอัตราชนะที่ปาร์ตี้แนะนำใกล้เคียงของเดิม (ไม่มีคอมโบ)
//   node test/tune-combo.js        → แสดงผลอย่างเดียว
//   node test/tune-combo.js write  → เขียนค่า maxHp ใหม่ลง game.js
const fs = require('fs'), path = require('path');
const G = require('../game');
const { rateMixed } = require('./balance-sim');
const out = {};
const only = process.env.ONLY;
for (const [k, m] of Object.entries(G.MONSTERS)) {
    if (only && only !== k) continue;
    const orig = m.maxHp;
    const target = rateMixed(k, m.rec, 300, 3.0, 0.9, { combo: false }).win;
    const dm = Number(process.env.DMGMULT) || 1; const origDmg = m.damage; m.damage = Math.max(origDmg, Math.round(origDmg * dm));
    let lo = orig * 0.6, hi = orig * 3.2;
    for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2; m.maxHp = mid;
        const w = rateMixed(k, m.rec, 120, 3.0, 0.9, { combo: true }).win;
        if (w > target) lo = mid; else hi = mid;
    }
    const hp = Math.round((lo + hi) / 2 / 50) * 50;
    m.maxHp = hp; out[k] = { hp, dmg: m.damage };
    console.log(k.padEnd(16), `เป้า ${Math.round(target * 100)}%`.padEnd(10), `HP ${orig} → ${hp}  ดาเมจบอส ${origDmg} → ${m.damage}`);
}
if (process.argv[2] === 'write') {
    const f = path.join(__dirname, '..', 'game.js'); let s = fs.readFileSync(f, 'utf8');
    for (const [k, v] of Object.entries(out)) { s = s.replace(new RegExp(`(${k}:\\s+\\{[^}]*?maxHp:\\s*)\\d+`), `$1${v.hp}`); s = s.replace(new RegExp(`(${k}:\\s+\\{[^}]*?damage:\\s*)\\d+`), `$1${v.dmg}`); }
    fs.writeFileSync(f, s); console.log('เขียนลง game.js แล้ว');
}
