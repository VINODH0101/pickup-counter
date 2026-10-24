import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

describe("Products & Orders API Integration Tests", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    loadEnv();
    await resetDatabase();
    await runMigrations();
    await seedDatabase();

    const app = createApp();
    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await closePool();
  });

  describe("GET /products — Basic Catalog Behavior", () => {
    it("returns catalog snacks with prices in paise, stock_units, and available_units", async () => {
      const res = await fetch(`${baseUrl}/products`);
      expect(res.status).toBe(200);

      const products: any = await res.json();
      expect(Array.isArray(products)).toBe(true);
      expect(products.length).toBeGreaterThanOrEqual(5);

      const chips = products.find((p: any) => p.name === "Chips");
      expect(chips).toBeDefined();
      expect(chips.price_paise).toBe(2000);
      expect(chips.stock_units).toBe(10);
      expect(chips.available_units).toBe(10);
    });
  });

  describe("POST /orders — Validation & Catalog Integrity", () => {
    it("rejects invalid request bodies and non-positive quantities", async () => {
      // Empty items array
      const res1 = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });
      expect(res1.status).toBe(400);

      // Non-positive quantity
      const res2 = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              productId: "00000000-0000-4000-8000-000000000001",
              quantity: 0,
            },
          ],
        }),
      });
      expect(res2.status).toBe(400);

      // Float quantity
      const res3 = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              productId: "00000000-0000-4000-8000-000000000001",
              quantity: 2.5,
            },
          ],
        }),
      });
      expect(res3.status).toBe(400);

      // Non-existent product ID
      const res4 = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              productId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
              quantity: 1,
            },
          ],
        }),
      });
      expect(res4.status).toBe(404);
    });

    it("consolidates duplicate product lines and computes total using PostgreSQL prices", async () => {
      const chipsId = "00000000-0000-4000-8000-000000000001"; // ₹20 = 2000 paise

      // Request sending duplicate lines for Chips: 2 + 3 = 5 units
      const res = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { productId: chipsId, quantity: 2 },
            { productId: chipsId, quantity: 3 },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const order: any = await res.json();

      expect(order.id).toBeDefined();
      expect(order.status).toBe("pending");
      // Total paise must equal 5 * 2000 = 10000 paise
      expect(order.total_paise).toBe(10000);
      expect(order.items.length).toBe(1);
      expect(order.items[0].product_id).toBe(chipsId);
      expect(order.items[0].quantity).toBe(5);
      expect(order.items[0].unit_price_paise).toBe(2000);

      // 120-second hold measured immediately before response
      expect(order.expiresInSeconds).toBeLessThanOrEqual(120);
      expect(order.expiresInSeconds).toBeGreaterThanOrEqual(115);

      // Available units for Chips should now be 10 - 5 = 5
      const prodRes = await fetch(`${baseUrl}/products`);
      const products: any = await prodRes.json();
      const chips = products.find((p: any) => p.id === chipsId);
      expect(chips.available_units).toBe(5);
      expect(chips.stock_units).toBe(10);
    });

    it("rejects order with 409 and rolls back all changes if any requested product lacks stock", async () => {
      const cookiesId = "00000000-0000-4000-8000-000000000002"; // stock = 8
      const juiceId = "00000000-0000-4000-8000-000000000004"; // stock = 6

      // Request 2 Cookies (available) and 10 Juice (only 6 available)
      const res = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { productId: cookiesId, quantity: 2 },
            { productId: juiceId, quantity: 10 },
          ],
        }),
      });

      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toMatch(/Insufficient stock for product 'Juice'/i);

      // Crucial: Rollback verification! Cookies must not have been partially reserved!
      const prodRes = await fetch(`${baseUrl}/products`);
      const products: any = await prodRes.json();
      const cookies = products.find((p: any) => p.id === cookiesId);
      expect(cookies.available_units).toBe(8); // Still all 8 available!
    });
  });

  describe("Real-Time Expiry & State Safety", () => {
    it("releases hold when order expires without relying solely on in-memory timers", async () => {
      const pool = getPool();
      const waterId = "00000000-0000-4000-8000-000000000005"; // stock = 10

      // Create an order whose hold expired in the past
      await pool.query(
        `INSERT INTO orders (status, total_paise, expires_at)
         VALUES ('pending', 1500, clock_timestamp() - INTERVAL '10 seconds')
         RETURNING id`,
      );
      const expiredOrderId = (
        await pool.query(
          "SELECT id FROM orders WHERE expires_at < clock_timestamp() LIMIT 1",
        )
      ).rows[0].id;

      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, 4, 1500)`,
        [expiredOrderId, waterId],
      );

      // Even without a background cron having run, the real-time query recognizes expires_at < clock_timestamp()
      const prodRes = await fetch(`${baseUrl}/products`);
      const products: any = await prodRes.json();
      const water = products.find((p: any) => p.id === waterId);
      // All 10 units must still be available because the 4 units belong to an expired order!
      expect(water.available_units).toBe(10);
    });
  });

  describe("CONCURRENCY SAFETY — 10 Concurrent Requests on Real PostgreSQL", () => {
    it("ensures ten concurrent customers attempting to order the last two units produce exactly two successes and eight clean failures", async () => {
      const pool = getPool();

      // Create a dedicated product with exactly 2 physical units
      const testProdRes = await pool.query(
        `INSERT INTO products (name, price_paise, stock_units)
         VALUES ('Last Two Units Snack', 1000, 2)
         RETURNING id`,
      );
      const testProdId = testProdRes.rows[0].id;

      // 10 concurrent requests, each attempting to buy 1 unit
      const requestCount = 10;
      const requests = Array.from({ length: requestCount }, () =>
        fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ productId: testProdId, quantity: 1 }],
          }),
        }),
      );

      // Execute all 10 requests concurrently against real PostgreSQL
      const responses = await Promise.all(requests);

      const successResponses = responses.filter((r) => r.status === 201);
      const conflictResponses = responses.filter((r) => r.status === 409);

      // Exactly 2 should succeed (as initial stock was 2)
      expect(successResponses.length).toBe(2);
      // Exactly 8 should be rejected with 409 Conflict
      expect(conflictResponses.length).toBe(8);

      // All 8 conflict responses should return clean insufficient stock error
      for (const conf of conflictResponses) {
        const body: any = await conf.json();
        expect(body.error).toMatch(/insufficient stock/i);
      }

      // Query the database directly to verify source of truth:
      // Exactly 2 order items should exist for this product
      const itemsCountRes = await pool.query(
        `SELECT SUM(oi.quantity)::integer AS total_reserved
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = $1 AND o.status = 'pending'`,
        [testProdId],
      );
      expect(itemsCountRes.rows[0].total_reserved).toBe(2);

      // Check available units in GET /products: must be 0
      const prodRes = await fetch(`${baseUrl}/products`);
      const products: any = await prodRes.json();
      const testProd = products.find((p: any) => p.id === testProdId);
      expect(testProd.available_units).toBe(0);
      expect(testProd.stock_units).toBe(2);
    });

    it("prevents deadlocks by sorting product IDs deterministically during multi-product checkouts", async () => {
      const pool = getPool();

      const prodA = (
        await pool.query(
          "INSERT INTO products (name, price_paise, stock_units) VALUES ('Deadlock Prod A', 1000, 20) RETURNING id",
        )
      ).rows[0].id;
      const prodB = (
        await pool.query(
          "INSERT INTO products (name, price_paise, stock_units) VALUES ('Deadlock Prod B', 1000, 20) RETURNING id",
        )
      ).rows[0].id;

      // Send concurrent requests with swapped item order: [A, B] vs [B, A]
      const concurrentSwappedRequests = [
        fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              { productId: prodA, quantity: 1 },
              { productId: prodB, quantity: 1 },
            ],
          }),
        }),
        fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              { productId: prodB, quantity: 1 },
              { productId: prodA, quantity: 1 },
            ],
          }),
        }),
        fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              { productId: prodA, quantity: 1 },
              { productId: prodB, quantity: 1 },
            ],
          }),
        }),
        fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              { productId: prodB, quantity: 1 },
              { productId: prodA, quantity: 1 },
            ],
          }),
        }),
      ];

      const responses = await Promise.all(concurrentSwappedRequests);
      for (const res of responses) {
        // All should succeed without any deadlock timeouts or 500 errors
        expect(res.status).toBe(201);
      }
    });
  });
});
