import crypto from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

describe("Pickup Claim API Integration Tests (Real PostgreSQL)", () => {
  let server: Server;
  let baseUrl: string;
  let webhookSecret: string;

  beforeAll(async () => {
    const env = loadEnv();
    webhookSecret = env.PAYMENT_WEBHOOK_SECRET;

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

  async function createAndPayOrder(productId: string, quantity: number) {
    // 1. Create order
    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId, quantity }],
      }),
    });
    expect(orderRes.status).toBe(201);
    const orderData: any = await orderRes.json();
    const orderId = orderData.orderId || orderData.id;
    const amountPaise = orderData.totalPaise || orderData.total_paise;

    // 2. Deliver valid payment capture webhook
    const payload = JSON.stringify({
      eventId: `evt_pay_${Date.now()}_${Math.random()}`,
      orderId,
      amountPaise,
      status: "captured",
    });
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(payload)
      .digest("hex");

    const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body: payload,
    });
    expect(webhookRes.status).toBe(200);

    return { orderId, amountPaise };
  }

  describe("CONCURRENCY SAFETY — Two Simultaneous Pickup Requests for the Same Order", () => {
    it("produces exactly one success (200), one 409 conflict, and decrements physical stock exactly once", async () => {
      const pool = getPool();
      const cookiesId = "00000000-0000-4000-8000-000000000002"; // Cookies initial stock = 8

      // Fetch initial physical stock
      const initialProdRes = await pool.query(
        "SELECT stock_units FROM products WHERE id = $1",
        [cookiesId],
      );
      const initialStock = initialProdRes.rows[0].stock_units;
      expect(initialStock).toBe(8);

      // Create and pay for an order of 3 Cookies
      const { orderId } = await createAndPayOrder(cookiesId, 3);

      // Verify order is paid
      const orderCheck = await pool.query(
        "SELECT status FROM orders WHERE id = $1",
        [orderId],
      );
      expect(orderCheck.rows[0].status).toBe("paid");

      // Verify available units in catalog is 8 - 3 = 5, but physical stock is still 8
      const midProdRes = await pool.query(
        "SELECT stock_units FROM products WHERE id = $1",
        [cookiesId],
      );
      expect(midProdRes.rows[0].stock_units).toBe(8);

      // SIMULTANEOUS PICKUP REQUESTS: Launch 2 concurrent claims at the exact same instant
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockerId: "locker_A1" }),
        }),
        fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockerId: "locker_A2" }),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // EXACTLY ONE SUCCESS (200) AND EXACTLY ONE 409 CONFLICT
      expect(statuses).toEqual([200, 409]);

      const successResponse = res1.status === 200 ? res1 : res2;
      const conflictResponse = res1.status === 409 ? res1 : res2;

      const successData: any = await successResponse.json();
      expect(successData.success).toBe(true);
      expect(successData.status).toBe("picked_up");
      expect(successData.orderId).toBe(orderId);

      const conflictData: any = await conflictResponse.json();
      expect(conflictData.error).toBe("ORDER_ALREADY_CLAIMED");
      expect(conflictData.message).toMatch(/already.*picked up|already.*claimed/i);

      // VERIFY DATABASE SOURCE OF TRUTH:
      // 1. Order status must be 'picked_up'
      const finalOrderRes = await pool.query(
        "SELECT status FROM orders WHERE id = $1",
        [orderId],
      );
      expect(finalOrderRes.rows[0].status).toBe("picked_up");

      // 2. Exactly one audit record in pickup_claims
      const claimCountRes = await pool.query(
        "SELECT COUNT(*)::int AS count FROM pickup_claims WHERE order_id = $1",
        [orderId],
      );
      expect(claimCountRes.rows[0].count).toBe(1);

      // 3. Physical stock decremented EXACTLY ONCE (from 8 to 5)
      const finalProdRes = await pool.query(
        "SELECT stock_units FROM products WHERE id = $1",
        [cookiesId],
      );
      expect(finalProdRes.rows[0].stock_units).toBe(5);

      // 4. Catalog available_units must now be 5
      const catalogRes = await fetch(`${baseUrl}/products`);
      const catalog: any = await catalogRes.json();
      const cookies = catalog.find((p: any) => p.id === cookiesId);
      expect(cookies.stock_units).toBe(5);
      expect(cookies.available_units).toBe(5);
    });
  });

  describe("State Guard: Only 'paid' Orders Can Be Claimed", () => {
    it("rejects pickup claim for an unpaid 'pending' order with 409", async () => {
      const juiceId = "00000000-0000-4000-8000-000000000004";

      // Create order but DO NOT pay
      const orderRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: juiceId, quantity: 1 }],
        }),
      });
      const orderData: any = await orderRes.json();
      const orderId = orderData.orderId || orderData.id;

      const claimRes = await fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
        method: "POST",
      });

      expect(claimRes.status).toBe(409);
      const data: any = await claimRes.json();
      expect(data.error).toBe("ORDER_NOT_PAID");
      expect(data.message).toMatch(/Cannot claim unpaid order/i);
    });

    it("rejects pickup claim for an 'expired' order with 409", async () => {
      const pool = getPool();
      const waterId = "00000000-0000-4000-8000-000000000005";

      // Directly insert an expired order
      const expiredRes = await pool.query(
        `INSERT INTO orders (status, total_paise, expires_at)
         VALUES ('expired', 1500, clock_timestamp() - INTERVAL '1 hour')
         RETURNING id`,
      );
      const expiredOrderId = expiredRes.rows[0].id;
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 1500)`,
        [expiredOrderId, waterId],
      );

      const claimRes = await fetch(
        `${baseUrl}/orders/${expiredOrderId}/pickup-claim`,
        { method: "POST" },
      );

      expect(claimRes.status).toBe(409);
      const data: any = await claimRes.json();
      expect(data.error).toBe("ORDER_EXPIRED");
      expect(data.message).toMatch(/Cannot claim expired order/i);
    });

    it("rejects pickup claim for an order in 'needs_review' status with 409", async () => {
      const pool = getPool();
      const waterId = "00000000-0000-4000-8000-000000000005";

      // Directly insert a needs_review order
      const reviewRes = await pool.query(
        `INSERT INTO orders (status, total_paise, expires_at)
         VALUES ('needs_review', 1500, clock_timestamp() + INTERVAL '10 minutes')
         RETURNING id`,
      );
      const reviewOrderId = reviewRes.rows[0].id;
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 1500)`,
        [reviewOrderId, waterId],
      );

      const claimRes = await fetch(
        `${baseUrl}/orders/${reviewOrderId}/pickup-claim`,
        { method: "POST" },
      );

      expect(claimRes.status).toBe(409);
      const data: any = await claimRes.json();
      expect(data.error).toBe("ORDER_NEEDS_REVIEW");
      expect(data.message).toMatch(/needs_review/i);
    });

    it("rejects pickup claim for an already 'picked_up' order with 409", async () => {
      const chipsId = "00000000-0000-4000-8000-000000000001";

      // Create and pay for an order
      const { orderId } = await createAndPayOrder(chipsId, 1);

      // First pickup claim succeeds
      const firstClaimRes = await fetch(
        `${baseUrl}/orders/${orderId}/pickup-claim`,
        { method: "POST" },
      );
      expect(firstClaimRes.status).toBe(200);

      // Second pickup claim fails with 409
      const secondClaimRes = await fetch(
        `${baseUrl}/orders/${orderId}/pickup-claim`,
        { method: "POST" },
      );
      expect(secondClaimRes.status).toBe(409);
      const data: any = await secondClaimRes.json();
      expect(data.error).toBe("ORDER_ALREADY_CLAIMED");
      expect(data.message).toMatch(/already.*picked up|already.*claimed/i);
    });

    it("returns 404 for non-existent order ID", async () => {
      const claimRes = await fetch(
        `${baseUrl}/orders/00000000-0000-0000-0000-000000000000/pickup-claim`,
        { method: "POST" },
      );
      expect(claimRes.status).toBe(404);
      const data: any = await claimRes.json();
      expect(data.error).toBe("ORDER_NOT_FOUND");
    });
  });
});
