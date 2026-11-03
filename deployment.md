# CampusOne — deployment and local run

Repository: https://github.com/ambitiouswithayush/campusone
Live app: https://campusone-livid.vercel.app

## Demo logins

Password for every demo account: **`Demo@2026`** (seeded demo data only; no real people).

| Role | Email | What to try |
|---|---|---|
| Faculty | `priya.das@campusone.test` | Attendance (works offline), mark entry for CS201, mentee tasks |
| Office admin — Engineering | `admin@campusone.test` | Dashboard, moderate & lock marks, fees, at-risk, Ask, Setup |
| Faculty | `rakesh.sahu@campusone.test` | Mechanical: Ankit Panda's mentor, ME201 draft sheet |
| Office admin — Management | `mgt.admin@campusone.test` | Shows campus isolation: sees only the MBA campus |

The sign-in page has one-tap buttons that fill these in.

Sample students from the brief, reproduced exactly:
`ENG-24-CSE-0412` Subhashree Mohanty (81.5 %, 33/40, ₹0),
`ENG-24-ME-0177` Ankit Panda (68.2 %, 21/40, ₹45,000 — flagged high risk),
`MBA-25-0093` Farheen Ali (92.0 %, 36/40, ₹0 — visible only to the MGT admin).

## Run locally (about 2 minutes)

Requirements: **Node.js 20 or 22** (`.nvmrc` says 22). No database install is needed — locally the app
uses PGlite, a real Postgres compiled to WebAssembly, stored in `./.data/`.

```bash
git clone https://github.com/ambitiouswithayush/campusone.git
cd campusone
npm install
npm run setup     # creates .env.local with a random SESSION_SECRET, migrates, seeds demo data
npm run dev       # http://localhost:3000
```

Other commands:

```bash
npm test          # 38 tests against an in-memory Postgres
npm run lint      # TypeScript type check
npm run db:reset  # wipe and reseed (stop `npm run dev` first — PGlite allows one process)
npm run build && npm start   # production build; the offline service worker only runs here
```

Trying offline attendance: run the production build (`npm run build && npm start`), sign in as Priya on
a phone-sized window, open **Attendance** once, then switch the browser to offline (DevTools → Network →
Offline). Reload — the class list still loads. Mark a class, submit, go back online: it syncs within seconds.

To use a local Postgres instead of PGlite, set `DATABASE_URL` in `.env.local` before `npm run setup`.

## How it is deployed

Target: **Vercel** (Next.js app + API routes + daily cron) with a **managed Postgres** (Neon, Supabase or
Vercel Postgres — any Postgres 14+).

**The live demo** runs on Vercel's Hobby plan with Neon's free tier, connected through Vercel's Storage
tab (which sets `DATABASE_URL`). Functions and the database both sit in Washington, D.C. (`iad1` /
`us-east-1`), which are Vercel's defaults; keeping them together matters more than distance to the user,
because each page makes several database round trips. For the trust's production, move both to Mumbai
(`bom1` / `ap-south-1`) for lower latency from Bhubaneswar and to keep student data in India.

1. Create a Postgres database and copy its connection string.
2. Import the GitHub repo into Vercel (framework preset: Next.js, no build overrides).
3. Add the environment variables below in Vercel → Settings → Environment Variables.
4. Deploy.
5. Once, from your machine, migrate and seed the hosted database:
   `DATABASE_URL="<connection string>" npm run setup`
6. `vercel.json` registers the nightly job (`/api/cron/daily`, 20:00 IST) — shortage alerts, fee
   reminders and the at-risk scan. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

Health check: `GET /api/health` returns `{"ok":true}` when the database answers.

**Keeping the hosted demo fresh.** The seed builds a semester of history ending on the day it runs
(today's timetable, the same-day marking rate, the 48-hour correction window). On a hosted copy that
data ages a day at a time, so reseed right before a review:
`DATABASE_URL="<connection string>" npm run db:reset` (wipes the demo database and seeds it again).

The app refuses to start on Vercel without `DATABASE_URL` (the embedded database cannot persist on
serverless functions). Any Node host with a persistent disk (Render, Railway, a VM) can also run it
with `npm run build && npm start`, with or without `DATABASE_URL`.

## Environment variables (names only)

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Production: yes. Local: no | Postgres connection string. Empty → embedded PGlite in `./.data` |
| `SESSION_SECRET` | Yes | ≥ 32 random characters for signing session cookies (`openssl rand -base64 32`) |
| `CRON_SECRET` | Production: yes | Shared secret Vercel Cron sends to `/api/cron/daily` |
| `GEMINI_API_KEY` | No | Enables the AI model for the Ask screen. Without it the built-in rule parser answers |
| `GEMINI_MODEL` | No | Defaults to `gemini-flash-latest` |
| `DB_POOL_MAX` | No | Postgres pool size per instance (default 5) |
| `PGLITE_DIR` | No | Where the embedded database lives locally (default `./.data/pglite`) |

No secrets are committed: `.env*` files are git-ignored and `.env.example` holds names only.
