import "../load-dotenv.js";
import { closePool } from "./client.js";
import { runMigrations } from "./migrate.js";

runMigrations()
  .then(async () => {
    await closePool();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await closePool();
    process.exitCode = 1;
  });
