# Deploying QuickCourt on Vercel + Turso

## Layout
- `public/` – the SPA (`index.html`) and `assets/`, served by Vercel's CDN
- `api/index.js` → `app.js` – the Express API, run as one serverless function (all `/api/*` routes rewritten to it in `vercel.json`)
- `server.js` – local dev only (`npm install && npm start`, uses `local.db`)

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)
| Name | Notes |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://…turso.io` (`turso db show <db> --url`) |
| `TURSO_AUTH_TOKEN` | `turso db tokens create <db>` |
| `SESSION_SECRET` | any long random string (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for "Continue with Google" (falls back to `GMAIL_CLIENT_*` if that is the same OAuth client) |
| `GMAIL_*`, `APP_URL`, `EMAIL_REMINDER_HOURS_BEFORE` | optional – booking emails |

Redeploy after changing variables.

## 2. Google sign-in
Google Cloud Console → APIs & Services → Credentials → your OAuth client (type **Web application**):
- Authorized redirect URI: `https://<your-site>.vercel.app/api/auth/google/callback`
- (Authorized JavaScript origins are not needed – the flow is server-side.)
- OAuth consent screen: while in "Testing", add your Gmail accounts as test users.

## 3. First run
The first request creates all tables in Turso and loads the demo data (users, venues, bookings, matches), exactly as the
local SQLite version did. Demo logins: `player@quickcourt.demo / Player@123`, `owner@quickcourt.demo / Owner@123`,
`admin@quickcourt.demo / Admin@123`.

## Notes
- Vercel rejects request bodies > 4.5 MB: keep facility photos small (≈3 photos of ≤1 MB).
- Times use `Asia/Kolkata` (override with `APP_TIMEZONE`).
- Reminder / "completed" emails run opportunistically on traffic and via the daily cron in `vercel.json` (Hobby plan allows daily crons only).
