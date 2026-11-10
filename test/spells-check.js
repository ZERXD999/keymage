'use strict';
// ตรวจคลังคาถาทุกสาย/ทุกภาษา: ไม่มีคาถาสั้นที่เป็น "คำขึ้นต้น" ของคาถายาว (ไม่งั้นท่ายาวพิมพ์ไม่ได้ เพราะท่าสั้นถูกร่ายก่อน)
// และทุกมือต้องมีคาถาสั้นอย่างน้อย 1 ใบ
const G = require('../game');
let bad = 0;
for (const cls of Object.keys(G.SPELLS)) {
    for (const [lang, pools] of [['en', G.SPELLS], ['th', G.SPELLS_TH]]) {
        const pool = pools[cls];
        if (!pool || pool.length !== G.SPELLS[cls].length) { console.log('✗ คลังคาถาไม่ครบ/ไม่ตรงกัน', cls, lang); bad++; continue; }
        for (const a of pool) for (const b of pool) if (a !== b && b.text.startsWith(a.text)) { console.log('✗ คำขึ้นต้นชนกัน', cls, lang, a.text, '→', b.text); bad++; }
    }
    for (let i = 0; i < 1500; i++) for (const lang of ['en', 'th', 'mix']) {
        const h = G.rollHand(cls, [], lang);
        if (h.length < 3 || !h.some(s => G.graphemeLength(s.text) <= G.SHORT_MAX)) { console.log('✗ มือไม่มีคาถาสั้น', cls, lang); bad++; i = 1e9; break; }
    }
}
if (bad) { console.log(`\nพบปัญหา ${bad} จุด`); process.exit(1); }
console.log(`ตรวจคาถา ${Object.keys(G.SPELLS).length} สาย × 3 โหมดภาษา ผ่านทั้งหมด ✅`);
