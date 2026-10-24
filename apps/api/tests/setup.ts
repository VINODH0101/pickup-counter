import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: path.join(apiRoot, ".env") });
dotenv.config({ path: path.join(apiRoot, ".env.test"), override: true });

if (!process.env["DATABASE_URL"]) {
  process.env["DATABASE_URL"] =
    "postgres://pickup:pickup@localhost:5432/pickup_counter_test";
}

if (!process.env["NODE_ENV"]) {
  process.env["NODE_ENV"] = "test";
}
