# QuickCourt — Vercel deployment

The UI files are unchanged. The deployment changes only the backend plumbing:
- the native `sqlite3` dependency is removed (it cannot run in Vercel's runtime);
- the API uses a Turso/libSQL database over HTTPS;
- the Express app is exposed as a Vercel serverless function;
- login sessions are signed/stateless so they survive Vercel instance changes.

## 1. Create an empty Turso database

Create a Turso/libSQL database and copy its database URL and auth token.
The database can be empty: QuickCourt creates its tables and demo data automatically on first startup.

## 2. Add Vercel environment variables

In **Vercel → Project → Settings → Environment Variables**, add:

- `TURSO_DATABASE_URL` — for example `libsql://your-db-your-org.turso.io`
- `TURSO_AUTH_TOKEN` — your Turso database token
- `SESSION_SECRET` — a long random secret

For Gmail, also add the values from `.env.example`:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_SENDER_EMAIL`
- `APP_URL` — your Vercel URL, e.g. `https://quickcourt-six.vercel.app`
- `EMAIL_REMINDER_HOURS_BEFORE` — optional, defaults to 2

## 3. Deploy

Import the repository into Vercel and deploy. No build command is needed.

The frontend continues to call `/api/...`, so no frontend/API URL change is needed.
