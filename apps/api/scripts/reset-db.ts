import "../src/load-dotenv.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";

async function main() {
  console.log("Resetting database schema...");
  await resetDatabase();
  console.log("Running migrations...");
  await runMigrations();
  console.log("Seeding deterministic data...");
  await seedDatabase();
  console.log("Database reset, migrated, and seeded successfully!");
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exitCode = 1;
});
