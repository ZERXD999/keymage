'use strict';
// โหลดไฟล์ .env แบบง่าย ๆ (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม) — ค่าที่ตั้งใน environment จริงจะชนะเสมอ
const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 1) continue;
        const key = line.slice(0, i).trim();
        let val = line.slice(i + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = val;
    }
}
module.exports = { loadEnv };
