/** Wipe the database and reseed. Refuses to run against production unless forced. */
import "./env";
import { rmSync } from "node:fs";
import { sql } from "drizzle-orm";

async function main() {
  if (process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_RESET !== "yes") {
      throw new Error("Refusing to reset a production database. Set ALLOW_RESET=yes to override.");
    }
  } else {
    rmSync(process.env.PGLITE_DIR ?? "./.data/pglite", { recursive: true, force: true });
  }
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  const { seed } = await import("../src/db/seed");
  const db = await getDb();
  if (process.env.DATABASE_URL) {
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  }
  await runMigrations(db);
  console.log("Seeding demo data…");
  const t0 = Date.now();
  await seed(db);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
