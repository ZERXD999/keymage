'use strict';
// ตัวจำกัดอัตราแบบหน้าต่างเวลา เก็บในหน่วยความจำ
function createLimiter(windowMs, max) {
    const map = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of map) if (v.reset <= now) map.delete(k);
    }, Math.min(windowMs, 60000));
    timer.unref();
    return {
        // คืน true ถ้ายังอนุญาต (และนับ 1 ครั้ง)
        hit(key) {
            const now = Date.now();
            let e = map.get(key);
            if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; map.set(key, e); }
            e.n++;
            return e.n <= max;
        },
        count(key) { const e = map.get(key); return e && e.reset > Date.now() ? e.n : 0; },
        clear(key) { map.delete(key); }
    };
}
module.exports = { createLimiter };
