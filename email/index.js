// Email service: `mail(event, to, ctx)` is the only thing the rest of the app calls.
//   business event (server.js) → mail() → template render → Gmail API transport → inbox
// Fire-and-forget: a failed/unconfigured email must never break a booking, so nothing here throws.
//
// GMAIL API: PENDING — set the GMAIL_* variables (see .env.example) and sending switches on; no code changes.
// Until then every mail() call is logged and skipped.

const { TEMPLATES } = require('./templates');

try { process.loadEnvFile?.(require('path').join(__dirname, '..', '.env')); } catch { /* no .env yet — fine */ }

const cfg = () => ({
  clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN, sender: process.env.GMAIL_SENDER_EMAIL,
  appUrl: process.env.APP_URL || 'http://localhost:3000',
});
const isConfigured = () => { const c = cfg(); return !!(c.clientId && c.clientSecret && c.refreshToken && c.sender); };
// How long before a game the reminder goes out — backend config, not UI.
const reminderHours = () => Number(process.env.EMAIL_REMINDER_HOURS_BEFORE) || 2;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const lines = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);

// Paper/ink/red layout, inline styles only (email clients ignore <style>).
function render(event, ctx) {
  const t = TEMPLATES[event];
  if (!t) throw new Error(`Unknown email event "${event}"`);
  const { appUrl } = cfg();
  const intro = lines(t.intro(ctx)), outro = lines(t.outro?.(ctx));
  const rows = (t.rows || []).filter(([, k]) => ctx[k] !== undefined && ctx[k] !== '');
  const p = (x) => `<p style="margin:0 0 14px;line-height:1.55">${esc(x)}</p>`;
  const html = `<div style="background:#F7F4EE;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:2px solid #111;border-radius:12px;overflow:hidden">
    <div style="background:#111;color:#F7F4EE;padding:16px 24px;font-size:20px;font-weight:900;letter-spacing:.04em">QUICK<span style="color:#E53935">COURT</span></div>
    <div style="padding:24px">${intro.map(p).join('')}
      ${rows.length ? `<table style="width:100%;border-collapse:collapse;margin:0 0 16px">${rows.map(([l, k]) => `<tr><td style="padding:6px 0;color:#6B6B67;width:120px">${esc(l)}</td><td style="padding:6px 0;font-weight:700">${esc(ctx[k])}</td></tr>`).join('')}</table>` : ''}
      ${t.cta ? `<p style="margin:18px 0"><a href="${esc(appUrl + '/' + t.cta[1])}" style="background:#E53935;color:#111;border:2px solid #111;border-radius:9px;padding:10px 18px;font-weight:700;text-decoration:none;display:inline-block">${esc(t.cta[0])} →</a></p>` : ''}
      ${outro.map(p).join('')}</div></div></div>`;
  const text = [...intro, rows.map(([l, k]) => `${l}: ${ctx[k]}`).join('\n'), ...outro].filter(Boolean).join('\n\n');
  return { subject: t.subject(ctx), html, text };
}

// ---- Gmail API transport (OAuth2 refresh-token flow, no SDK needed) ----
let token = { value: '', exp: 0 };
async function accessToken() {
  if (token.exp > Date.now() + 30000) return token.value;
  const c = cfg();
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gmail auth failed: ${j.error_description || j.error}`);
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
async function gmailSend({ to, subject, html, text }) {
  const c = cfg(), boundary = 'qc_' + Date.now().toString(36);
  const raw = [`From: QuickCourt <${c.sender}>`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html), `--${boundary}--`].join('\r\n');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }) });
  if (!r.ok) throw new Error(`Gmail send failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

/** mail('bookingConfirmed', 'player@x.com', { name, venueName, ... }) — never throws, never blocks the caller. */
function mail(event, to, ctx = {}) {
  if (!to) return;
  if (!isConfigured()) return console.log(`[email] skipped "${event}" → ${to} (Gmail API not configured)`);
  Promise.resolve().then(() => gmailSend({ to, ...render(event, ctx) }))
    .then(() => console.log(`[email] sent "${event}" → ${to}`))
    .catch((e) => console.error(`[email] "${event}" → ${to} failed: ${e.message}`));
}

module.exports = { mail, render, isConfigured, reminderHours };
