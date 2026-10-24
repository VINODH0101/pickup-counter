import "../load-dotenv.js";
import { closePool } from "./client.js";
import { seedDatabase } from "./seed.js";

seedDatabase()
  .then(async () => {
    await closePool();
  })
  .catch(async (error: unknown) => {
    console.error("Seed failed:", error);
    await closePool();
    process.exitCode = 1;
  });
