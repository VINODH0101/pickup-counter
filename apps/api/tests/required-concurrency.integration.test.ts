import crypto from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

/**
 * Pickup Counter — Required Concurrency & Integration Test Suite
 *
 * Requirements verified against real PostgreSQL:
 * 1. Ten concurrent customers attempting to order the last two units:
 *    - Exactly two successful orders (HTTP 201).
 *    - Exactly eight clean insufficient-stock failures (HTTP 409).
 *    - Zero over-selling; remaining available inventory is 0.
 * 2. Signed webhook event delivered twice:
 *    - Sequential duplicate: 2nd delivery is acknowledged idempotently (duplicate: true).
 *    - Concurrent duplicate: Simultaneous webhook arrivals produce exactly 1 insertion in payment_events.
 * 3. Two simultaneous pickup claims for the same paid order:
 *    - Exactly one succeeds (HTTP 200).
 *    - Exactly one fails with HTTP 409 Conflict.
 *    - Physical stock in PostgreSQL decrements exactly once.
 * 4. Partial-reservation rollback:
 *    - When an order contains multiple items and one item lacks stock,
 *      no units are reserved for ANY item, and no order row is persisted.
 * 5. Real-time hold expiry:
 *    - Expired holds dynamically release units without background cron jobs.
 * 6. Payment amount mismatch:
 *    - Webhook with mismatched amount flags order as needs_review, never paid.
 * 7. Webhook signature security:
 *    - Tampered payloads, invalid secrets, or missing signatures reject with HTTP 401.
 */
describe("Required Concurrency & State Invariants Integration Suite (Real PostgreSQL)", () => {
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

  function sign(payload: string, secret: string = webhookSecret): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  // ---------------------------------------------------------------------------
  // REQUIREMENT 1: 10 CONCURRENT CUSTOMERS ORDERING THE LAST TWO UNITS
  // ---------------------------------------------------------------------------
  describe("Requirement 1: 10 Concurrent Customers for Last 2 Units", () => {
    it("produces exactly two successful orders and eight clean insufficient-stock failures", async () => {
      const pool = getPool();

      // Setup: Create a distinct product with exactly 2 physical units
      const prodRes = await pool.query(
        `INSERT INTO products (name, price_paise, stock_units)
         VALUES ('Scarce Snack Box', 5000, 2)
         RETURNING id`,
      );
      const scarceProdId = prodRes.rows[0].id;

      // Launch 10 simultaneous orders for 1 unit each
      const customerCount = 10;
      const orderPromises = Array.from({ length: customerCount }, () =>
        fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ productId: scarceProdId, quantity: 1 }],
          }),
        }),
      );

      const responses = await Promise.all(orderPromises);

      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      // Invariants: Exactly 2 succeed, exactly 8 fail
      expect(successes.length).toBe(2);
      expect(conflicts.length).toBe(8);

      // Verify all 8 conflict responses return clear error message
      for (const conf of conflicts) {
        const body: any = await conf.json();
        expect(body.error).toMatch(/insufficient stock/i);
      }

      // Verify PostgreSQL source of truth
      const orderItems = await pool.query(
        `SELECT SUM(oi.quantity)::integer AS total_reserved
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = $1 AND o.status = 'pending'`,
        [scarceProdId],
      );
      expect(orderItems.rows[0].total_reserved).toBe(2);

      // Verify physical stock never becomes negative and remains exactly 2
      const dbProd = await pool.query(
        "SELECT stock_units FROM products WHERE id = $1",
        [scarceProdId],
      );
      expect(dbProd.rows[0].stock_units).toBe(2);
      expect(dbProd.rows[0].stock_units).toBeGreaterThanOrEqual(0);

      // Verify total number of orders created for this product across entire DB is exactly 2 (no partials)
      const ordersCount = await pool.query(
        `SELECT COUNT(DISTINCT o.id)::int AS count
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE oi.product_id = $1`,
        [scarceProdId],
      );
      expect(ordersCount.rows[0].count).toBe(2);

      // Verify available inventory is now 0, while physical stock remains 2
      const catRes = await fetch(`${baseUrl}/products`);
      const catalog: any = await catRes.json();
      const product = catalog.find((p: any) => p.id === scarceProdId);
      expect(product.available_units).toBe(0);
      expect(product.stock_units).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 2: SIGNED WEBHOOK DELIVERED TWICE (SEQUENTIAL & CONCURRENT)
  // ---------------------------------------------------------------------------
  describe("Requirement 2: Signed Webhook Duplicate Delivery", () => {
    it("handles sequential duplicate deliveries idempotently", async () => {
      const pool = getPool();
      const chipsId = "00000000-0000-4000-8000-000000000001"; // ₹20 = 2000 paise

      // Create an order
      const oRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: chipsId, quantity: 1 }],
        }),
      });
      const oData: any = await oRes.json();
      const orderId = oData.orderId || oData.id;

      const eventId = `evt_seq_dup_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 2000,
        status: "captured",
      });
      const signature = sign(payload);

      // 1st delivery
      const res1 = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": signature },
        body: payload,
      });
      expect(res1.status).toBe(200);
      const data1: any = await res1.json();
      expect(data1.received).toBe(true);
      expect(data1.duplicate).toBe(false);
      expect(data1.orderStatus).toBe("paid");

      // 2nd delivery with identical eventId
      const res2 = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": signature },
        body: payload,
      });
      expect(res2.status).toBe(200);
      const data2: any = await res2.json();
      expect(data2.received).toBe(true);
      expect(data2.duplicate).toBe(true);

      // Verify PostgreSQL has exactly 1 event record
      const countRes = await pool.query(
        "SELECT COUNT(*)::int AS count FROM payment_events WHERE event_id = $1",
        [eventId],
      );
      expect(countRes.rows[0].count).toBe(1);
    });

    it("handles concurrent duplicate webhook deliveries without duplicate insertions or errors", async () => {
      const pool = getPool();
      const waterId = "00000000-0000-4000-8000-000000000005"; // ₹15 = 1500 paise

      // Create an order
      const oRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: waterId, quantity: 1 }],
        }),
      });
      const oData: any = await oRes.json();
      const orderId = oData.orderId || oData.id;

      const eventId = `evt_conc_dup_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 1500,
        status: "captured",
      });
      const signature = sign(payload);

      // Fire 2 simultaneous webhook deliveries
      const [resA, resB] = await Promise.all([
        fetch(`${baseUrl}/payments/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Signature": signature },
          body: payload,
        }),
        fetch(`${baseUrl}/payments/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Signature": signature },
          body: payload,
        }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const dataA: any = await resA.json();
      const dataB: any = await resB.json();

      expect(dataA.received).toBe(true);
      expect(dataB.received).toBe(true);

      const duplicates = [dataA.duplicate, dataB.duplicate].sort();
      expect(duplicates).toEqual([false, true]);

      // Verify PostgreSQL state
      const orderCheck = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(orderCheck.rows[0].status).toBe("paid");

      const eventCount = await pool.query(
        "SELECT COUNT(*)::int AS count FROM payment_events WHERE event_id = $1",
        [eventId],
      );
      expect(eventCount.rows[0].count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 3: TWO SIMULTANEOUS PICKUP CLAIMS FOR THE SAME PAID ORDER
  // ---------------------------------------------------------------------------
  describe("Requirement 3: Two Simultaneous Pickup Claims", () => {
    it("produces exactly one success (200), one 409 conflict, and decrements physical stock exactly once", async () => {
      const pool = getPool();
      const cookiesId = "00000000-0000-4000-8000-000000000002"; // 8 initial stock

      // Check stock before
      const prodBefore = await pool.query("SELECT stock_units FROM products WHERE id = $1", [cookiesId]);
      const initialStock = prodBefore.rows[0].stock_units;

      // 1. Create order for 2 cookies
      const oRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: cookiesId, quantity: 2 }],
        }),
      });
      const oData: any = await oRes.json();
      const orderId = oData.orderId || oData.id;

      // 2. Pay for order
      const eventId = `evt_pay_pickup_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 6000,
        status: "captured",
      });
      const sig = sign(payload);
      const payRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": sig },
        body: payload,
      });
      expect(payRes.status).toBe(200);

      // Verify order is paid
      const orderCheck = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(orderCheck.rows[0].status).toBe("paid");

      // 3. Fire 2 simultaneous pickup claims
      const [claim1, claim2] = await Promise.all([
        fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockerId: "locker_01" }),
        }),
        fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockerId: "locker_02" }),
        }),
      ]);

      const statuses = [claim1.status, claim2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const successRes = claim1.status === 200 ? claim1 : claim2;
      const conflictRes = claim1.status === 409 ? claim1 : claim2;

      const successData: any = await successRes.json();
      expect(successData.status).toBe("picked_up");
      expect(successData.orderId).toBe(orderId);

      const conflictData: any = await conflictRes.json();
      expect(conflictData.error).toBe("ORDER_ALREADY_CLAIMED");

      // 4. Source of truth verification in PostgreSQL
      const finalOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(finalOrder.rows[0].status).toBe("picked_up");

      // Audit records: exactly 1 claim in pickup_claims
      const claimsCount = await pool.query(
        "SELECT COUNT(*)::int AS count FROM pickup_claims WHERE order_id = $1",
        [orderId],
      );
      expect(claimsCount.rows[0].count).toBe(1);

      // Physical inventory: decremented exactly once by 2 units
      const prodAfter = await pool.query("SELECT stock_units FROM products WHERE id = $1", [cookiesId]);
      expect(prodAfter.rows[0].stock_units).toBe(initialStock - 2);
    });
  });

  // ---------------------------------------------------------------------------
  // ADDITIONAL TEST 4: PARTIAL-RESERVATION ROLLBACK
  // ---------------------------------------------------------------------------
  describe("Additional Invariant: Partial-Reservation Rollback", () => {
    it("rolls back all changes completely if any product in a multi-item order lacks stock", async () => {
      const pool = getPool();

      // Create Product A with 10 units, and Product B with 1 unit
      const prodARes = await pool.query(
        "INSERT INTO products (name, price_paise, stock_units) VALUES ('Abundant Item', 1000, 10) RETURNING id",
      );
      const prodBRes = await pool.query(
        "INSERT INTO products (name, price_paise, stock_units) VALUES ('Scarce Item', 2000, 1) RETURNING id",
      );
      const prodAId = prodARes.rows[0].id;
      const prodBId = prodBRes.rows[0].id;

      const ordersBefore = await pool.query("SELECT COUNT(*)::int AS count FROM orders");
      const orderCountBefore = ordersBefore.rows[0].count;

      // Request 5 of Product A (available) and 3 of Product B (only 1 exists!)
      const res = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { productId: prodAId, quantity: 5 },
            { productId: prodBId, quantity: 3 },
          ],
        }),
      });

      expect(res.status).toBe(409);
      const data: any = await res.json();
      expect(data.error).toMatch(/insufficient stock/i);

      // Check PostgreSQL: Zero new orders created
      const ordersAfter = await pool.query("SELECT COUNT(*)::int AS count FROM orders");
      expect(ordersAfter.rows[0].count).toBe(orderCountBefore);

      // Check Product A: Available units must be completely untouched (10/10)
      const catRes = await fetch(`${baseUrl}/products`);
      const cat: any = await catRes.json();
      const prodA = cat.find((p: any) => p.id === prodAId);
      expect(prodA.available_units).toBe(10);
      expect(prodA.stock_units).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // ADDITIONAL TEST 5: REAL-TIME HOLD EXPIRY
  // ---------------------------------------------------------------------------
  describe("Additional Invariant: Dynamic Hold Expiry", () => {
    it("dynamically frees inventory without background cron and rejects pickup of expired order", async () => {
      const pool = getPool();
      const juiceId = "00000000-0000-4000-8000-000000000004";

      // Directly insert an expired order
      const expOrder = await pool.query(
        `INSERT INTO orders (status, total_paise, expires_at)
         VALUES ('pending', 4500, clock_timestamp() - INTERVAL '5 seconds')
         RETURNING id`,
      );
      const expOrderId = expOrder.rows[0].id;
      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, 2, 4500)",
        [expOrderId, juiceId],
      );

      // GET /products should immediately report available_units unaffected by expired hold
      const pRes = await fetch(`${baseUrl}/products`);
      const products: any = await pRes.json();
      const juice = products.find((p: any) => p.id === juiceId);
      expect(juice.available_units).toBe(juice.stock_units);

      // Attempting pickup on expired order must fail with 409
      const claimRes = await fetch(`${baseUrl}/orders/${expOrderId}/pickup-claim`, { method: "POST" });
      expect(claimRes.status).toBe(409);
      const claimData: any = await claimRes.json();
      expect(claimData.error).toBe("ORDER_NOT_PAID");
    });
  });

  // ---------------------------------------------------------------------------
  // ADDITIONAL TEST 6: AMOUNT MISMATCH
  // ---------------------------------------------------------------------------
  describe("Additional Invariant: Payment Amount Mismatch", () => {
    it("marks order needs_review and never marks paid when amount does not match", async () => {
      const pool = getPool();
      const waterId = "00000000-0000-4000-8000-000000000005"; // 1500 paise

      // Create order for 1500 paise
      const oRes = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: waterId, quantity: 1 }],
        }),
      });
      const oData: any = await oRes.json();
      const orderId = oData.orderId || oData.id;

      // Deliver webhook with mismatched amount: 1000 paise instead of 1500
      const eventId = `evt_mismatch_${Date.now()}`;
      const payload = JSON.stringify({
        eventId,
        orderId,
        amountPaise: 1000, // Mismatched!
        status: "captured",
      });
      const sig = sign(payload);

      const payRes = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": sig },
        body: payload,
      });
      expect(payRes.status).toBe(200);
      const payData: any = await payRes.json();
      expect(payData.orderStatus).toBe("needs_review");

      // Verify PostgreSQL state
      const check = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
      expect(check.rows[0].status).toBe("needs_review");

      // Verify pickup claim cannot be performed on needs_review order
      const claimRes = await fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, { method: "POST" });
      expect(claimRes.status).toBe(409);
      const claimData: any = await claimRes.json();
      expect(claimData.error).toBe("ORDER_NEEDS_REVIEW");
    });
  });

  // ---------------------------------------------------------------------------
  // ADDITIONAL TEST 7: WEBHOOK SIGNATURE INTEGRITY & TAMPERING
  // ---------------------------------------------------------------------------
  describe("Additional Invariant: Webhook Signature Security", () => {
    it("rejects missing signature with HTTP 401", async () => {
      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: "evt_1", orderId: "00000000-0000-0000-0000-000000000000" }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects signature signed with wrong secret with HTTP 401", async () => {
      const payload = JSON.stringify({ eventId: "evt_2", orderId: "00000000-0000-0000-0000-000000000000" });
      const badSig = sign(payload, "incorrect_secret_xyz");

      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": badSig },
        body: payload,
      });
      expect(res.status).toBe(401);
    });

    it("rejects tampered raw payload with HTTP 401", async () => {
      const originalPayload = JSON.stringify({ eventId: "evt_3", amountPaise: 2000 });
      const sig = sign(originalPayload);
      const tamperedPayload = JSON.stringify({ eventId: "evt_3", amountPaise: 1000 }); // Changed byte!

      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": sig },
        body: tamperedPayload,
      });
      expect(res.status).toBe(401);
    });
  });
});
