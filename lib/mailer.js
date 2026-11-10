'use strict';
const os = require('os');

function lanUrls(port) {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
    }
    return out;
}

function createMailer(env, port) {
    const host = env.SMTP_HOST;
    let transporter = null;
    if (host) {
        const nodemailer = require('nodemailer');
        const portNum = Number(env.SMTP_PORT) || 587;
        transporter = nodemailer.createTransport({
            host,
            port: portNum,
            secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : portNum === 465,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
        });
    }
    const from = env.MAIL_FROM || env.SMTP_USER || 'KeyMage <no-reply@localhost>';

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    async function sendReset(to, username, link) {
        const text = `สวัสดี ${username}\n\nมีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชี KeyMage ของคุณ\nกดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ 30 นาที และใช้ได้ครั้งเดียว):\n${link}\n\nถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ`;
        const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0f0d24;color:#eceaff;border-radius:14px">
<h2 style="color:#f5c451;letter-spacing:2px;margin:0 0 12px">KEYMAGE</h2>
<p>สวัสดี <b>${esc(username)}</b></p>
<p>มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์ใช้ได้ 30 นาที และใช้ได้ครั้งเดียว)</p>
<p style="text-align:center;margin:26px 0"><a href="${esc(link)}" style="background:#f5c451;color:#2b1e00;padding:12px 26px;border-radius:10px;text-decoration:none;font-weight:700">ตั้งรหัสผ่านใหม่</a></p>
<p style="font-size:13px;color:#a19dd0">ถ้ากดปุ่มไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br>${esc(link)}</p>
<p style="font-size:13px;color:#a19dd0">ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p></div>`;

        if (!transporter) {
            console.log('\n[mail:dev] ยังไม่ได้ตั้งค่า SMTP — แสดงลิงก์รีเซ็ตในคอนโซลแทนการส่งอีเมล');
            console.log(`[mail:dev] ถึง: ${to}\n[mail:dev] ลิงก์: ${link}\n`);
            return;
        }
        await transporter.sendMail({ from, to, subject: 'รีเซ็ตรหัสผ่าน KeyMage', text, html });
    }

    return { sendReset, enabled: !!transporter };
}

module.exports = { createMailer, lanUrls };
