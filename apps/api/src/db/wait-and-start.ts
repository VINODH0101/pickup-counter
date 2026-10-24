import "../load-dotenv.js";
import { getPool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedDatabase } from "./seed.js";

async function waitForDb(maxRetries = 30, delayMs = 1000): Promise<void> {
  const pool = getPool();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log(`[DB Ready] Connected to PostgreSQL on attempt ${attempt}`);
      return;
    } catch (err: any) {
      console.log(`[Waiting for DB] Attempt ${attempt}/${maxRetries}: ${err.message}`);
      if (attempt === maxRetries) {
        throw new Error(`Failed to connect to PostgreSQL after ${maxRetries} attempts: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function initAndStart(): Promise<void> {
  console.log("=== PICKUP COUNTER API INITIALIZING ===");
  await waitForDb();

  console.log("[Migrations] Running database migrations...");
  await runMigrations();

  console.log("[Seed] Ensuring deterministic seed data...");
  await seedDatabase();

  console.log("[API Server] Launching Express HTTP server...");
  await import("../index.js");
}

if (process.env.NODE_ENV !== "test") {
  initAndStart().catch((err) => {
    console.error("Initialization failed:", err);
    process.exit(1);
  });
}
