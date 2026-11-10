'use strict';
// ที่เก็บข้อมูลผู้เล่นเป็นไฟล์ JSON (ไม่ต้องใช้ฐานข้อมูลภายนอก/ไม่ต้องคอมไพล์ native module)
// เขียนแบบ atomic (เขียนไฟล์ชั่วคราวแล้ว rename) และรวมการเขียนถี่ ๆ เป็นชุด
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const GUEST_TTL = 24 * 3600 * 1000;
const RESET_TTL = 30 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(password, stored) {
    const [alg, saltHex, hashHex] = String(stored || '').split('$');
    if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
    const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
    const expect = Buffer.from(hashHex, 'hex');
    return key.length === expect.length && crypto.timingSafeEqual(key, expect);
}

class Store {
    constructor(file) {
        this.file = file;
        this.data = { users: {}, sessions: {}, resets: {} };
        this.byEmail = new Map();
        this.byName = new Map();
        this.timer = null;
        this.writing = false;
        this.again = false;
        this.load();
    }

    load() {
        let raw;
        try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') console.error('[store] read error', e); }
        if (raw) {
            try {
                const d = JSON.parse(raw);
                this.data = { users: d.users || {}, sessions: d.sessions || {}, resets: d.resets || {} };
            } catch (e) {
                const bak = `${this.file}.corrupt-${Date.now()}`;
                console.error(`[store] ไฟล์ข้อมูลเสียหาย สำรองไว้ที่ ${bak}`);
                try { fs.renameSync(this.file, bak); } catch (e2) { /* ignore */ }
            }
        }
        for (const u of Object.values(this.data.users)) this.index(u);
        this.cleanup();
    }

    index(u) { this.byEmail.set(u.email, u.id); this.byName.set(u.username.toLowerCase(), u.id); }

    schedule() {
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 1500);
        this.timer.unref();
    }

    async flush() {
        if (this.writing) { this.again = true; return; }
        this.writing = true;
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = this.file + '.tmp';
            await fs.promises.writeFile(tmp, JSON.stringify(this.data), 'utf8');
            await fs.promises.rename(tmp, this.file);
        } catch (e) {
            console.error('[store] write error', e);
        } finally {
            this.writing = false;
            if (this.again) { this.again = false; this.schedule(); }
        }
    }

    flushSync() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data), 'utf8');
            fs.renameSync(this.file + '.tmp', this.file);
        } catch (e) { console.error('[store] flushSync error', e); }
    }

    cleanup() {
        const now = Date.now();
        for (const [k, v] of Object.entries(this.data.sessions)) if (v.exp <= now) delete this.data.sessions[k];
        for (const [k, v] of Object.entries(this.data.resets)) if (v.exp <= now) delete this.data.resets[k];
        // ล้างบัญชีผู้เยี่ยมชมที่ไม่มีเซสชันเหลือและเก่ากว่า 3 วัน
        const live = new Set(Object.values(this.data.sessions).map(s => s.userId));
        for (const u of Object.values(this.data.users)) {
            if (u.guest && !live.has(u.id) && now - u.createdAt > 3 * 24 * 3600 * 1000) {
                delete this.data.users[u.id]; this.byEmail.delete(u.email); this.byName.delete(u.username.toLowerCase());
            }
        }
    }

    /* ---------- ผู้ใช้ ---------- */
    findByEmail(email) { const id = this.byEmail.get(String(email).toLowerCase()); return id ? this.data.users[id] : null; }
    findByName(name) { const id = this.byName.get(String(name).toLowerCase()); return id ? this.data.users[id] : null; }
    getUser(id) { return this.data.users[id] || null; }

    // บัญชีผู้เยี่ยมชม: ไม่ต้องใช้อีเมล/รหัสผ่าน ล็อกอินด้วยรหัสผ่านไม่ได้ (pass = '!') ใช้ได้ 24 ชั่วโมง
    createGuest() {
        let username = '', tries = 0;
        do { username = 'Guest' + Math.floor(1000 + Math.random() * 9000); } while (this.byName.has(username.toLowerCase()) && ++tries < 60);
        if (this.byName.has(username.toLowerCase())) return null;
        const id = crypto.randomUUID();
        const u = { id, email: `guest-${id}@guest.invalid`, username, pass: '!', guest: true, score: 0, wins: 0, battles: 0, createdAt: Date.now() };
        this.data.users[id] = u; this.index(u); this.schedule();
        return u;
    }

    async createUser({ email, username, password }) {
        const u = {
            id: crypto.randomUUID(), email: email.toLowerCase(), username,
            pass: await hashPassword(password), score: 0, wins: 0, battles: 0, createdAt: Date.now()
        };
        // ตรวจซ้ำอีกครั้งหลัง await กัน race
        if (this.byEmail.has(u.email) || this.byName.has(username.toLowerCase())) return null;
        this.data.users[u.id] = u;
        this.index(u);
        this.schedule();
        return u;
    }

    async setPassword(id, password) {
        const u = this.data.users[id];
        if (!u) return;
        u.pass = await hashPassword(password);
        this.schedule();
    }

    addScore(id, n) { const u = this.data.users[id]; if (u && n > 0) { u.score += Math.round(n); this.schedule(); } }
    addResult(id, won) { const u = this.data.users[id]; if (u) { u.battles++; if (won) u.wins++; this.schedule(); } }

    /* ---------- เซสชัน / โทเคนรีเซ็ต ---------- */
    createSession(userId, ttl = SESSION_TTL) {
        const token = crypto.randomBytes(32).toString('base64url');
        this.data.sessions[sha(token)] = { userId, exp: Date.now() + ttl };
        this.schedule();
        return token;
    }
    getSession(token) {
        if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
        const s = this.data.sessions[sha(token)];
        if (!s || s.exp <= Date.now()) return null;
        return this.data.users[s.userId] || null;
    }
    deleteSession(token) { if (typeof token === 'string') { delete this.data.sessions[sha(token)]; this.schedule(); } }
    deleteUserSessions(userId) {
        for (const [k, v] of Object.entries(this.data.sessions)) if (v.userId === userId) delete this.data.sessions[k];
        this.schedule();
    }
    createReset(userId) {
        for (const [k, v] of Object.entries(this.data.resets)) if (v.userId === userId) delete this.data.resets[k]; // ใช้ได้ทีละลิงก์
        const token = crypto.randomBytes(32).toString('base64url');
        this.data.resets[sha(token)] = { userId, exp: Date.now() + RESET_TTL };
        this.schedule();
        return token;
    }
    peekReset(token) {
        if (typeof token !== 'string' || token.length > 100) return null;
        const r = this.data.resets[sha(token)];
        return r && r.exp > Date.now() ? r.userId : null;
    }
    consumeReset(token) {
        const id = this.peekReset(token);
        if (id) { delete this.data.resets[sha(token)]; this.schedule(); }
        return id;
    }
}

module.exports = { Store, verifyPassword, hashPassword, RESET_TTL, GUEST_TTL };
