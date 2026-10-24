import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Server } from "node:http";

describe("health", () => {
  let server: Server;

  afterAll(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns ok", async () => {
    const app = createApp();
    server = app.listen(0);

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
