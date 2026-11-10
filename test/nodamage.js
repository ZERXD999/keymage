'use strict';
// อัตรา No Damage ของผู้เล่นที่ชนะ ตามความเร็วพิมพ์ (ตัวอักษร/วินาที): node test/nodamage.js [trials]
const G = require('../game');
const { rateMixed } = require('./balance-sim');
const trials = Number(process.argv[2]) || 80;
const speeds = [['พิมพ์ปกติ 3.0', 3.0], ['เร็ว 5.0', 5.0], ['โปร 7.0', 7.0]];
console.log('มอนสเตอร์'.padEnd(16) + 'แนะนำ  ' + speeds.map(([n]) => n.padEnd(22)).join(''));
for (const k of ['SLIME', 'SKELETON', 'OGRE', 'NAGA', 'SKELETON_MAGE', 'DRAGON']) {
    const m = G.MONSTERS[k];
    const cells = speeds.map(([, c]) => { const r = rateMixed(k, m.rec, trials, c, 0.3, { combo: true }); return `ชนะ ${Math.round(r.win * 100)}% / ND ${Math.round(r.noDmg * 100)}%`.padEnd(22); });
    console.log(k.padEnd(16) + String(m.rec).padEnd(7) + cells.join(''));
}
