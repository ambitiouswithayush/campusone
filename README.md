# CampusOne

One record per student — from admission to graduation — for Company A's three colleges.
This first phase covers one campus end to end: **masters for a programme, mobile attendance that works
offline in class, internal marks with a moderation lock, fee dues, and an at-risk early warning.**

- **Faculty** take attendance on their phones in under 30 seconds per class — with or without Wi-Fi — and enter internal marks once.
- **Office staff** moderate and lock marks, export the university upload file, collect fees, export receipts to Tally, and ask questions in plain English.
- **Automation** sends shortage alerts and fee reminders (mocked SMS, English or Odia), and flags at-risk students as mentor tasks.

→ Run it: [deployment.md](deployment.md) · Design: [docs/TDD.pdf](docs/TDD.pdf)

```
npm install && npm run setup && npm run dev
```

Stack: Next.js 15 (App Router) · TypeScript · Postgres via Drizzle ORM (PGlite locally) · Tailwind CSS 4 ·
service worker + IndexedDB for offline · Vitest.

```
src/
  app/(app)/today        offline attendance (faculty)
  app/(app)/marks        mark sheets: entry, moderation, lock, export
  app/(app)/students     student list and single student record
  app/(app)/fees         dues, receipts, payment links, Tally export
  app/(app)/risk         at-risk mentor tasks
  app/(app)/ask          plain-English, read-only questions
  app/(app)/dashboard    campus dashboard
  app/(app)/setup        masters, calendar, audit log
  lib/sync.ts            attendance sync rules (idempotency, conflicts, edit window)
  lib/marks.ts           marks workflow and university CSV
  lib/risk.ts            explainable at-risk score
  lib/assistant/         question → validated filter spec → scoped read-only query
  lib/offline/           IndexedDB store, outbox, sync client
  db/schema.ts           data model; db/seed.ts demo data
tests/                   37 tests on an in-memory Postgres
```
