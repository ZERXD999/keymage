'use strict';
const G = require('../game');
const { rateMixed } = require('./balance-sim');
const sizes = [1, 2, 3, 4, 5, 6, 7, 8];
const trials = Math.max(10, Math.min(500, Number(process.env.BALANCE_TRIALS) || 25));
console.log(`มอนสเตอร์        (จำลอง ${trials} รอบต่อขนาดปาร์ตี้)`);
console.log('                 ' + sizes.map(n => (n + ' คน').padEnd(10)).join(''));
for (const k of Object.keys(G.MONSTERS)) {
    const m = G.MONSTERS[k];
    const row = sizes.map(n => { const r = rateMixed(k, n, trials); return `${String(Math.round(r.win * 100)).padStart(3)}% ${r.win ? Math.round(r.time) + 's' : ''}`.padEnd(10); });
    console.log(`${k.padEnd(15)}  ` + row.join('') + `  (แนะนำ ${m.rec})`);
}
