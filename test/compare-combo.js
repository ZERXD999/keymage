'use strict';
// เทียบอัตราชนะ "ไม่มีคอมโบ" กับ "มีคอมโบ" ที่ปาร์ตี้ขนาดแนะนำ: node test/compare-combo.js [trials]
const G = require('../game');
const { rateMixed } = require('./balance-sim');
const trials = Number(process.argv[2]) || 200;
console.log('มอนสเตอร์'.padEnd(16) + 'แนะนำ  ไม่มีคอมโบ        มีคอมโบ         No-Damage(ผู้เล่นที่ชนะ)');
for (const [k, m] of Object.entries(G.MONSTERS)) {
    const a = rateMixed(k, m.rec, trials, 3.0, 0.9, { combo: false });
    const b = rateMixed(k, m.rec, trials, 3.0, 0.9, { combo: true });
    console.log(k.padEnd(16) + String(m.rec).padEnd(7) + `${Math.round(a.win * 100)}% ${Math.round(a.time)}s`.padEnd(17) + `${Math.round(b.win * 100)}% ${Math.round(b.time)}s`.padEnd(16) + `${Math.round(b.noDmg * 100)}%`);
}
