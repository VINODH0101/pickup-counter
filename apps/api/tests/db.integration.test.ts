import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../src/db/client.js";
import { loadEnv } from "../src/env.js";
import { runMigrations } from "../src/db/migrate.js";

describe("postgres connectivity", () => {
  afterAll(async () => {
    await closePool();
  });

  it("applies SQL migrations against a real database", async () => {
    loadEnv();
    await runMigrations();

    const result = await getPool().query(
      "SELECT id FROM schema_migrations ORDER BY id",
    );
    expect(result.rows.map((row) => row.id)).toContain("001_init.sql");
  });
});
