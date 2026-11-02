/**
 * One-command local setup: creates .env.local with a random session secret (if missing),
 * applies migrations and seeds demo data when the database is empty.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync(".env.local")) {
  const template = readFileSync(".env.example", "utf8");
  writeFileSync(".env.local", template.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(32).toString("base64")}`));
  console.log("Created .env.local with a fresh SESSION_SECRET");
}

async function main() {
  await import("./env");
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  const { seed } = await import("../src/db/seed");
  const { campuses } = await import("../src/db/schema");
  const db = await getDb();
  console.log("Applying migrations…");
  await runMigrations(db);
  const existing = await db.select().from(campuses).limit(1);
  if (existing.length) {
    console.log("Database already has data — skipping seed (use `npm run db:reset` to start over).");
  } else {
    console.log("Seeding demo data…");
    await seed(db);
  }
  console.log("Done. Run `npm run dev` and open http://localhost:3000");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
