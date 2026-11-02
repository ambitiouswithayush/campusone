import "./env";

async function main() {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations(await getDb());
  console.log("Migrations applied.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
