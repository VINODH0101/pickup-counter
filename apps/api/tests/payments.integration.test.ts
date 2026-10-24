import crypto from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

describe("Payment Webhook API Integration Tests (Real PostgreSQL)", () => {
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

  function signPayload(payloadString: string, secret: string = webhookSecret): string {
    return crypto.createHmac("sha256", secret).update(payloadString).digest("hex");
  }

  describe("Webhook Signature Verification", () => {
    it("rejects requests with missing X-Signature header", async () => {
      const payload = JSON.stringify({
        eventId: "evt_missing_sig",
        orderId: "00000000-0000-0000-0000-000000000000",
        amountPaise: 2000,
      });

      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      expect(res.status).toBe(401);
      const data: any = await res.json();
      expect(data.error).toMatch(/Invalid or missing webhook signature/i);
    });

    it("rejects requests signed with an incorrect secret", async () => {
      const payload = JSON.stringify({
        eventId: "evt_wrong_secret",
        orderId: "00000000-0000-0000-0000-000000000000",
        amountPaise: 2000,
      });

      const wrongSignature = signPayload(payload, "incorrect_wrong_secret_123");

      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": wrongSignature,
        },
        body: payload,
      });

      expect(res.status).toBe(401);
      const data: any = await res.json();
      expect(data.error).toMatch(/Invalid or missing webhook signature/i);
    });

    it("rejects malformed non-hex signatures safely", async () => {
      const payload = JSON.stringify({
        eventId: "evt_malformed_sig",
        orderId: "00000000-0000-0000-0000-000000000000",
        amountPaise: 2000,
      });

      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": "not-a-valid-hex-signature!!",
        },
        body: payload,
      });

      expect(res.status).toBe(401);
    });
  });

  describe("Correct Capture Processing", () => {
    it("atomically records payment_event and transitions pending order to paid", async () => {
      const pool = getPool();
      const chipsId = "00000000-0000-4000-8000-000000000001"; // ₹20 = 2000 paise

      // 1. Create a pending order for 1 Chips (2000 paise)
      const orderRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: chipsId, quantity: 1 }],
        }),
      });
      expect(orderRes.status).toBe(201);
      const orderData: any = await orderRes.json();
      const orderId = orderData.orderId || orderData.id;
      expect(orderData.status).toBe("pending");
      expect(orderData.totalPaise).toBe(2000);

      // 2. Deliver valid webhook payment capture
      const eventId = `evt_correct_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 2000,
        status: "succeeded",
      });
      const signature = signPayload(payload);

      const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body: payload,
      });

      expect(webhookRes.status).toBe(200);
      const webhookData: any = await webhookRes.json();
      expect(webhookData.received).toBe(true);
      expect(webhookData.duplicate).toBe(false);
      expect(webhookData.orderStatus).toBe("paid");

      // 3. Verify order in PostgreSQL is now 'paid'
      const checkOrder = await pool.query("SELECT status, total_paise FROM orders WHERE id = $1", [
        orderId,
      ]);
      expect(checkOrder.rows[0].status).toBe("paid");

      // 4. Verify payment_events record in PostgreSQL
      const checkEvent = await pool.query(
        "SELECT event_id, order_id, amount_paise, status FROM payment_events WHERE event_id = $1",
        [eventId],
      );
      expect(checkEvent.rows.length).toBe(1);
      expect(checkEvent.rows[0].amount_paise).toBe(2000);

      // 5. Verify paid uncollected order continues to reserve stock (Chips stock_units 10, available 9)
      const prodRes = await fetch(`${baseUrl}/products`);
      const products: any = await prodRes.json();
      const chips = products.find((p: any) => p.id === chipsId);
      expect(chips.available_units).toBe(9);
    });
  });

  describe("Incorrect Payment Amount", () => {
    it("marks order needs_review and NEVER marks it paid when amount does not match", async () => {
      const pool = getPool();
      const cookiesId = "00000000-0000-4000-8000-000000000002"; // ₹30 = 3000 paise

      // Create order for 1 Cookies (total 3000 paise)
      const orderRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: cookiesId, quantity: 1 }],
        }),
      });
      const orderData: any = await orderRes.json();
      const orderId = orderData.orderId || orderData.id;

      // Webhook arrives with mismatched amount: 1500 paise instead of 3000
      const eventId = `evt_mismatch_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 1500, // Mismatched!
        status: "succeeded",
      });
      const signature = signPayload(payload);

      const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body: payload,
      });

      expect(webhookRes.status).toBe(200);
      const webhookData: any = await webhookRes.json();
      expect(webhookData.orderStatus).toBe("needs_review");

      // Verify PostgreSQL state
      const checkOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(checkOrder.rows[0].status).toBe("needs_review");
    });

    it("does not mark order paid when payment status is unsupported (e.g. 'failed')", async () => {
      const pool = getPool();
      const waterId = "00000000-0000-4000-8000-000000000005"; // ₹15 = 1500 paise

      const orderRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: waterId, quantity: 1 }],
        }),
      });
      const orderData: any = await orderRes.json();
      const orderId = orderData.orderId || orderData.id;

      const eventId = `evt_failed_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 1500,
        status: "failed", // Unsupported/failed status
      });
      const signature = signPayload(payload);

      const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body: payload,
      });

      expect(webhookRes.status).toBe(200);
      const webhookData: any = await webhookRes.json();
      expect(webhookData.orderStatus).not.toBe("paid");
      expect(webhookData.orderStatus).toBe("needs_review");

      const checkOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(checkOrder.rows[0].status).toBe("needs_review");
    });
  });

  describe("Duplicate Delivery Idempotency", () => {
    it("handles repeated webhook deliveries idempotently without re-modifying order state", async () => {
      const pool = getPool();
      const waterId = "00000000-0000-4000-8000-000000000005"; // ₹15 = 1500 paise

      // Create order
      const orderRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: waterId, quantity: 1 }],
        }),
      });
      const orderData: any = await orderRes.json();
      const orderId = orderData.orderId || orderData.id;

      const eventId = `evt_idempotent_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 1500,
        status: "succeeded",
      });
      const signature = signPayload(payload);

      // First webhook delivery -> transitions to 'paid'
      const firstRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body: payload,
      });
      expect(firstRes.status).toBe(200);
      const firstData: any = await firstRes.json();
      expect(firstData.duplicate).toBe(false);
      expect(firstData.orderStatus).toBe("paid");

      // Repeated webhook delivery with identical eventId
      const secondRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body: payload,
      });
      expect(secondRes.status).toBe(200);
      const secondData: any = await secondRes.json();
      expect(secondData.duplicate).toBe(true);

      // Exactly 1 payment_event record must exist for eventId
      const eventCount = await pool.query(
        "SELECT COUNT(*)::int AS count FROM payment_events WHERE event_id = $1",
        [eventId],
      );
      expect(eventCount.rows[0].count).toBe(1);
    });

    it("handles concurrent duplicate webhook deliveries safely without multiple insertions or race conditions", async () => {
      const pool = getPool();
      const juiceId = "00000000-0000-4000-8000-000000000004"; // ₹45 = 4500 paise

      // Create order
      const orderRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: juiceId, quantity: 1 }],
        }),
      });
      const orderData: any = await orderRes.json();
      const orderId = orderData.orderId || orderData.id;

      const eventId = `evt_concurrent_dup_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 4500,
        status: "succeeded",
      });
      const signature = signPayload(payload);

      // Launch 2 concurrent identical webhook deliveries simultaneously
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/payments/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature": signature,
          },
          body: payload,
        }),
        fetch(`${baseUrl}/payments/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature": signature,
          },
          body: payload,
        }),
      ]);

      // Both must return HTTP 200
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const data1: any = await res1.json();
      const data2: any = await res2.json();

      expect(data1.received).toBe(true);
      expect(data2.received).toBe(true);

      // Exactly one should be duplicate: false, and one duplicate: true
      const duplicates = [data1.duplicate, data2.duplicate].sort();
      expect(duplicates).toEqual([false, true]);

      // Order must be marked 'paid'
      const checkOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(checkOrder.rows[0].status).toBe("paid");

      // Exactly ONE row in payment_events for this eventId
      const eventCount = await pool.query(
        "SELECT COUNT(*)::int AS count FROM payment_events WHERE event_id = $1",
        [eventId],
      );
      expect(eventCount.rows[0].count).toBe(1);
    });
  });

  describe("Late Capture After Expiry", () => {
    it("sets order to needs_review when capture arrives after hold expiry and does not automatically reclaim stock", async () => {
      const pool = getPool();
      const chocId = "00000000-0000-4000-8000-000000000003"; // ₹25 = 2500 paise

      // Create order whose hold expired in the past
      const expiredOrderRes = await pool.query(
        `INSERT INTO orders (status, total_paise, expires_at)
         VALUES ('pending', 2500, clock_timestamp() - INTERVAL '30 seconds')
         RETURNING id`,
      );
      const expiredOrderId = expiredOrderRes.rows[0].id;
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 2500)`,
        [expiredOrderId, chocId],
      );

      // Check stock before late webhook: Chocolate bar stock 12, available 12 (since hold expired)
      const beforeProdRes = await fetch(`${baseUrl}/products`);
      const beforeProducts: any = await beforeProdRes.json();
      const chocBefore = beforeProducts.find((p: any) => p.id === chocId);
      expect(chocBefore.available_units).toBe(12);

      // Webhook arrives late for the expired hold
      const eventId = `evt_late_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId: expiredOrderId,
        amountPaise: 2500,
        status: "succeeded",
      });
      const signature = signPayload(payload);

      const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body: payload,
      });

      expect(webhookRes.status).toBe(200);
      const data: any = await webhookRes.json();
      // Must be marked needs_review, NEVER paid!
      expect(data.orderStatus).toBe("needs_review");

      // Verify in DB
      const checkOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [
        expiredOrderId,
      ]);
      expect(checkOrder.rows[0].status).toBe("needs_review");

      // Critical requirement: MUST NOT automatically reclaim stock!
      // Available units must remain 12 (not decremented or reclaimed into another hold)
      const afterProdRes = await fetch(`${baseUrl}/products`);
      const afterProducts: any = await afterProdRes.json();
      const chocAfter = afterProducts.find((p: any) => p.id === chocId);
      expect(chocAfter.available_units).toBe(12);
    });
  });

  describe("Terminal State Protection", () => {
    it("ensures a payment webhook cannot overwrite an order already in picked_up state", async () => {
      const pool = getPool();

      // Create an order in 'picked_up' state
      const orderRes = await pool.query(
        `INSERT INTO orders (status, total_paise, expires_at)
         VALUES ('picked_up', 2000, clock_timestamp() + INTERVAL '1 hour')
         RETURNING id`,
      );
      const orderId = orderRes.rows[0].id;

      const eventId = `evt_terminal_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 2000,
        status: "succeeded",
      });
      const signature = signPayload(payload);

      const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body: payload,
      });

      expect(webhookRes.status).toBe(200);
      const data: any = await webhookRes.json();
      expect(data.orderStatus).toBe("picked_up");

      // State remains 'picked_up' in DB
      const checkOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(checkOrder.rows[0].status).toBe("picked_up");
    });
  });
});
