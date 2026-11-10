'use strict';
// เทียบความแรงของแต่ละสายอาชีพ (ภาษาอังกฤษ): ปาร์ตี้ทั้งห้องเป็นสายเดียวกัน
//   node test/class-balance.js [monster] [trials]
const G = require('../game');
const { simulate, typist } = require('./balance-sim');
const monster = process.argv[2] || 'NAGA';
const trials = Number(process.argv[3]) || 150;
const rec = G.MONSTERS[monster].rec;
const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const rows = [];
for (const cls of Object.keys(G.SPELLS)) {
    let w = 0, t = 0, nd = 0, pl = 0;
    for (let i = 0; i < trials; i++) {
        const party = Array.from({ length: rec }, () => typist(Math.min(7, Math.max(1.5, 3 + 0.9 * randn()))));
        const r = simulate(monster, party, cls, { combo: true });
        if (r.win) { w++; t += r.time; nd += r.nodmg; pl += rec; }
    }
    rows.push({ cls, win: w / trials, time: w ? t / w : 0, nd: pl ? nd / pl : 0 });
}
rows.sort((a, b) => b.win - a.win);
console.log(`${monster} (ปาร์ตี้ ${rec} คน สายเดียวกันทั้งทีม, พิมพ์ ~3 ตัว/วิ)`);
for (const r of rows) console.log(r.cls.padEnd(13), `ชนะ ${Math.round(r.win * 100)}%`.padEnd(10), `เวลา ${Math.round(r.time)}s`.padEnd(11), `ND ${Math.round(r.nd * 100)}%`);
