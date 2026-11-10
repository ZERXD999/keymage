'use strict';
const express = require('express');
const { verifyPassword, GUEST_TTL } = require('./store');
const { createLimiter } = require('./ratelimit');

const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,255}\.[^\s@<>]{2,}$/;
const NAME_RE = /^[\p{L}\p{N}_.\- ]{3,16}$/u;

// หมายเหตุ: เครื่องเดียวกัน/ไวไฟเดียวกันอาจใช้ IP เดียวกันทั้งห้อง จึงตั้งลิมิตต่อ IP ไว้กว้าง
// ส่วนการเดารหัสผ่านจะจำกัดต่อบัญชีแทน
const L = {
    register: createLimiter(10 * 60 * 1000, 150),
    guest: createLimiter(10 * 60 * 1000, 300),
    login: createLimiter(10 * 60 * 1000, 600),
    loginFail: createLimiter(10 * 60 * 1000, 8),
    forgotIp: createLimiter(60 * 60 * 1000, 60),
    forgotMail: createLimiter(60 * 60 * 1000, 3),
    reset: createLimiter(60 * 60 * 1000, 60)
};

const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);

function bearer(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function createAuthRouter({ store, mailer, baseUrl, onPasswordReset }) {
    const r = express.Router();
    r.use(express.json({ limit: '4kb' }));

    const publicUser = (u) => ({ id: u.id, username: u.username, score: u.score, wins: u.wins });
    const fail = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

    r.post('/register', async (req, res) => {
        try {
            if (!L.register.hit(req.ip)) return fail(res, 429, 'ลองบ่อยเกินไป กรุณารอสักครู่');
            const email = str(req.body.email, 254).trim().toLowerCase();
            const username = str(req.body.username, 40).replace(/\s+/g, ' ').trim();
            const password = str(req.body.password, 200);
            if (!EMAIL_RE.test(email)) return fail(res, 400, 'รูปแบบอีเมลไม่ถูกต้อง');
            if (!NAME_RE.test(username)) return fail(res, 400, 'ชื่อจอมเวทต้องยาว 3–16 ตัวอักษร ใช้ได้เฉพาะตัวอักษร ตัวเลข _ . - และเว้นวรรค');
            if (password.length < 8 || password.length > 72) return fail(res, 400, 'รหัสผ่านต้องยาว 8–72 ตัวอักษร');
            if (store.findByEmail(email)) return fail(res, 409, 'อีเมลนี้ถูกใช้สมัครแล้ว');
            if (store.findByName(username)) return fail(res, 409, 'ชื่อจอมเวทนี้ถูกใช้แล้ว');
            const u = await store.createUser({ email, username, password });
            if (!u) return fail(res, 409, 'อีเมลหรือชื่อนี้ถูกใช้แล้ว');
            res.json({ ok: true, token: store.createSession(u.id), user: publicUser(u) });
        } catch (e) { console.error('[auth] register', e); fail(res, 500, 'เซิร์ฟเวอร์ผิดพลาด ลองใหม่อีกครั้ง'); }
    });

    r.post('/login', async (req, res) => {
        try {
            if (!L.login.hit(req.ip)) return fail(res, 429, 'ลองบ่อยเกินไป กรุณารอสักครู่');
            const id = str(req.body.identifier, 254).trim().toLowerCase();
            const password = str(req.body.password, 200);
            if (!id || !password) return fail(res, 400, 'กรอกอีเมล/ชื่อ และรหัสผ่านให้ครบ');
            if (L.loginFail.count(id) >= 8) return fail(res, 429, 'ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 10 นาที หรือใช้ "ลืมรหัสผ่าน"');
            const u = id.includes('@') ? store.findByEmail(id) : store.findByName(id);
            const ok = await verifyPassword(password, u ? u.pass : DUMMY_HASH);
            if (!u || !ok) { L.loginFail.hit(id); return fail(res, 401, 'อีเมล/ชื่อ หรือรหัสผ่านไม่ถูกต้อง'); }
            L.loginFail.clear(id);
            res.json({ ok: true, token: store.createSession(u.id), user: publicUser(u) });
        } catch (e) { console.error('[auth] login', e); fail(res, 500, 'เซิร์ฟเวอร์ผิดพลาด ลองใหม่อีกครั้ง'); }
    });

    // เข้าเล่นทันทีแบบผู้เยี่ยมชม (ไม่ต้องสมัคร/ล็อกอิน) — สำหรับให้คนอื่นเปิดดูเกมผ่านลิงก์
    r.post('/guest', (req, res) => {
        try {
            if (!L.guest.hit(req.ip)) return fail(res, 429, 'ลองบ่อยเกินไป กรุณารอสักครู่');
            const u = store.createGuest();
            if (!u) return fail(res, 500, 'สร้างบัญชีผู้เยี่ยมชมไม่สำเร็จ ลองใหม่อีกครั้ง');
            res.json({ ok: true, token: store.createSession(u.id, GUEST_TTL), user: publicUser(u) });
        } catch (e) { console.error('[auth] guest', e); fail(res, 500, 'เซิร์ฟเวอร์ผิดพลาด ลองใหม่อีกครั้ง'); }
    });

    r.post('/logout', (req, res) => { store.deleteSession(bearer(req)); res.json({ ok: true }); });

    // ตอบเหมือนกันเสมอ ไม่บอกว่ามีอีเมลนี้ในระบบหรือไม่ (กันการไล่เดาอีเมล)
    r.post('/forgot', (req, res) => {
        const generic = { ok: true, message: 'ถ้าอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว (ลิงก์ใช้ได้ 30 นาที) กรุณาตรวจสอบกล่องจดหมายและจดหมายขยะ' };
        try {
            if (!L.forgotIp.hit(req.ip)) return fail(res, 429, 'ลองบ่อยเกินไป กรุณารอสักครู่');
            const email = str(req.body.email, 254).trim().toLowerCase();
            if (!EMAIL_RE.test(email)) return res.json(generic);
            const u = store.findByEmail(email);
            if (u && !u.guest && L.forgotMail.hit(email)) {
                const link = `${baseUrl}/reset?token=${store.createReset(u.id)}`;
                mailer.sendReset(u.email, u.username, link).catch((e) => console.error('[mail] ส่งอีเมลไม่สำเร็จ:', e.message));
            }
            res.json(generic);
        } catch (e) { console.error('[auth] forgot', e); res.json(generic); }
    });

    r.post('/reset/check', (req, res) => {
        if (!L.reset.hit(req.ip)) return fail(res, 429, 'ลองบ่อยเกินไป กรุณารอสักครู่');
        res.json({ ok: !!store.peekReset(str(req.body.token, 100)) });
    });

    r.post('/reset', async (req, res) => {
        try {
            if (!L.reset.hit(req.ip)) return fail(res, 429, 'ลองบ่อยเกินไป กรุณารอสักครู่');
            const password = str(req.body.password, 200);
            if (password.length < 8 || password.length > 72) return fail(res, 400, 'รหัสผ่านต้องยาว 8–72 ตัวอักษร');
            const userId = store.consumeReset(str(req.body.token, 100));
            if (!userId) return fail(res, 400, 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่');
            await store.setPassword(userId, password);
            store.deleteUserSessions(userId);
            onPasswordReset(userId);
            res.json({ ok: true });
        } catch (e) { console.error('[auth] reset', e); fail(res, 500, 'เซิร์ฟเวอร์ผิดพลาด ลองใหม่อีกครั้ง'); }
    });

    return r;
}

module.exports = { createAuthRouter };
