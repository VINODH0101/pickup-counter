import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

describe("PostgreSQL Schema & Constraints Integration Tests", () => {
  beforeAll(async () => {
    loadEnv();
    await resetDatabase();
    await runMigrations();
    await seedDatabase();
  });

  afterAll(async () => {
    await closePool();
  });

  describe("Step 4.4 — Deterministic Seed Data", () => {
    it("has exactly five seeded products with correct integer paise prices and stock_units", async () => {
      const pool = getPool();
      const res = await pool.query(
        "SELECT id, name, price_paise, stock_units FROM products ORDER BY price_paise ASC",
      );

      expect(res.rows.length).toBe(5);

      const expectedProducts = [
        { name: "Water bottle", price_paise: 1500, stock_units: 10 },
        { name: "Chips", price_paise: 2000, stock_units: 10 },
        { name: "Chocolate bar", price_paise: 2500, stock_units: 12 },
        { name: "Cookies", price_paise: 3000, stock_units: 8 },
        { name: "Juice", price_paise: 4500, stock_units: 6 },
      ];

      for (const expected of expectedProducts) {
        const found = res.rows.find((r) => r.name === expected.name);
        expect(found).toBeDefined();
        expect(found.price_paise).toBe(expected.price_paise);
        expect(Number.isInteger(found.price_paise)).toBe(true);
        expect(found.stock_units).toBe(expected.stock_units);
      }
    });
  });

  describe("Step 4.2 — Products Invariants & Constraints", () => {
    it("rejects negative product price_paise", async () => {
      const pool = getPool();
      await expect(
        pool.query(
          "INSERT INTO products (name, price_paise, stock_units) VALUES ($1, $2, $3)",
          ["Invalid Negative Price Item", -100, 10],
        ),
      ).rejects.toThrow(/check constraint|products_price_paise_check/i);
    });

    it("rejects negative stock_units", async () => {
      const pool = getPool();
      await expect(
        pool.query(
          "INSERT INTO products (name, price_paise, stock_units) VALUES ($1, $2, $3)",
          ["Invalid Negative Stock Item", 1000, -5],
        ),
      ).rejects.toThrow(/check constraint|products_stock_units_check/i);
    });

    it("rejects empty product name", async () => {
      const pool = getPool();
      await expect(
        pool.query(
          "INSERT INTO products (name, price_paise, stock_units) VALUES ($1, $2, $3)",
          ["   ", 1000, 10],
        ),
      ).rejects.toThrow(/check constraint|products_name_check/i);
    });
  });

  describe("Step 4.1 — Explicit Order States & Hold Expiration", () => {
    const validStates = [
      "pending",
      "paid",
      "picked_up",
      "expired",
      "needs_review",
    ] as const;

    for (const status of validStates) {
      it(`accepts explicit state '${status}' with expires_at timestamp`, async () => {
        const pool = getPool();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        const orderRes = await pool.query(
          "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, $3) RETURNING id, status, expires_at",
          [status, 3000, expiresAt],
        );
        expect(orderRes.rows[0].status).toBe(status);
        expect(new Date(orderRes.rows[0].expires_at).getTime()).toBe(
          expiresAt.getTime(),
        );
      });
    }

    it("rejects unapproved order states (e.g. 'completed', 'cancelled', 'dispatched')", async () => {
      const pool = getPool();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await expect(
        pool.query(
          "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, $3)",
          ["completed", 3000, expiresAt],
        ),
      ).rejects.toThrow(/check constraint|orders_status_check/i);
    });

    it("rejects negative order total_paise", async () => {
      const pool = getPool();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await expect(
        pool.query(
          "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, $3)",
          ["pending", -500, expiresAt],
        ),
      ).rejects.toThrow(/check constraint|orders_total_paise_check/i);
    });
  });

  describe("Step 4.3 — Price Snapshotting & Order Items Constraints", () => {
    it("snapshots unit_price_paise into order_items and isolates historical orders from future price modifications", async () => {
      const pool = getPool();

      // 1. Fetch chips
      const prodRes = await pool.query(
        "SELECT id, price_paise FROM products WHERE name = 'Chips'",
      );
      const chips = prodRes.rows[0];
      expect(chips.price_paise).toBe(2000);

      // 2. Create order with price snapshot
      const orderRes = await pool.query(
        "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id",
        ["pending", chips.price_paise * 3],
      );
      const orderId = orderRes.rows[0].id;

      // 3. Snapshot unit_price_paise into order_items
      const itemRes = await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [orderId, chips.id, 3, chips.price_paise],
      );
      expect(itemRes.rows[0].unit_price_paise).toBe(2000);
      expect(itemRes.rows[0].quantity).toBe(3);

      // 4. Price change occurs in products catalog (e.g., inflation to ₹35 = 3500 paise)
      await pool.query("UPDATE products SET price_paise = 3500 WHERE id = $1", [
        chips.id,
      ]);

      // 5. Existing order_item snapshot remains unchanged
      const verifyRes = await pool.query(
        "SELECT unit_price_paise, quantity FROM order_items WHERE id = $1",
        [itemRes.rows[0].id],
      );
      expect(verifyRes.rows[0].unit_price_paise).toBe(2000);

      // Restore price
      await pool.query("UPDATE products SET price_paise = 2000 WHERE id = $1", [
        chips.id,
      ]);
    });

    it("rejects non-positive order_item quantity (quantity <= 0)", async () => {
      const pool = getPool();
      const orderRes = await pool.query(
        "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id",
        ["pending", 0],
      );
      const orderId = orderRes.rows[0].id;
      const prodRes = await pool.query(
        "SELECT id FROM products WHERE name = 'Chips'",
      );
      const productId = prodRes.rows[0].id;

      await expect(
        pool.query(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, $3, $4)",
          [orderId, productId, 0, 2000],
        ),
      ).rejects.toThrow(/check constraint|order_items_quantity_check/i);

      await expect(
        pool.query(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, $3, $4)",
          [orderId, productId, -3, 2000],
        ),
      ).rejects.toThrow(/check constraint|order_items_quantity_check/i);
    });

    it("enforces unique constraint on (order_id, product_id) to consolidate duplicate lines", async () => {
      const pool = getPool();
      const orderRes = await pool.query(
        "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id",
        ["pending", 4000],
      );
      const orderId = orderRes.rows[0].id;
      const prodRes = await pool.query(
        "SELECT id FROM products WHERE name = 'Cookies'",
      );
      const productId = prodRes.rows[0].id;

      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, $3, $4)",
        [orderId, productId, 1, 3000],
      );

      await expect(
        pool.query(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, $3, $4)",
          [orderId, productId, 2, 3000],
        ),
      ).rejects.toThrow(/unique constraint|uq_order_items_order_product/i);
    });

    it("cascades deletion from orders to order_items (ON DELETE CASCADE)", async () => {
      const pool = getPool();
      const orderRes = await pool.query(
        "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id",
        ["pending", 2000],
      );
      const orderId = orderRes.rows[0].id;
      const prodRes = await pool.query(
        "SELECT id FROM products WHERE name = 'Chips'",
      );
      const productId = prodRes.rows[0].id;

      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, $3, $4)",
        [orderId, productId, 1, 2000],
      );

      // Delete the order
      await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);

      // Associated order_items must be gone
      const items = await pool.query(
        "SELECT * FROM order_items WHERE order_id = $1",
        [orderId],
      );
      expect(items.rows.length).toBe(0);
    });

    it("prevents deleting product referenced by historical order_items (ON DELETE RESTRICT)", async () => {
      const pool = getPool();
      const prodRes = await pool.query(
        "SELECT id FROM products WHERE name = 'Water bottle'",
      );
      const productId = prodRes.rows[0].id;

      const orderRes = await pool.query(
        "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id",
        ["pending", 1500],
      );
      await pool.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, $3, $4)",
        [orderRes.rows[0].id, productId, 1, 1500],
      );

      await expect(
        pool.query("DELETE FROM products WHERE id = $1", [productId]),
      ).rejects.toThrow(/foreign key constraint/i);
    });
  });

  describe("Payment Events & Idempotency", () => {
    it("enforces unique payment_events.event_id for webhook idempotency", async () => {
      const pool = getPool();
      const orderRes = await pool.query(
        "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id",
        ["pending", 4500],
      );
      const orderId = orderRes.rows[0].id;
      const eventId = `evt_webhook_${Date.now()}`;

      // First webhook arrives
      const eventRes = await pool.query(
        `INSERT INTO payment_events (event_id, order_id, amount_paise, status, raw_payload)
         VALUES ($1, $2, $3, $4, $5) RETURNING received_at`,
        [eventId, orderId, 4500, "succeeded", '{"status":"succeeded"}'],
      );
      expect(eventRes.rows[0].received_at).toBeDefined();

      // Duplicate webhook delivery with exact same event_id must violate unique constraint
      await expect(
        pool.query(
          `INSERT INTO payment_events (event_id, order_id, amount_paise, status, raw_payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [eventId, orderId, 4500, "succeeded", '{"status":"succeeded"}'],
        ),
      ).rejects.toThrow(/unique constraint|payment_events_event_id_key/i);
    });
  });

  describe("Pickup Claims Audit (One Claim per Order)", () => {
    it("enforces unique order_id on pickup_claims allowing exactly one simultaneous claim to succeed", async () => {
      const pool = getPool();
      const orderRes = await pool.query(
        "INSERT INTO orders (status, total_paise, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id",
        ["paid", 3000],
      );
      const orderId = orderRes.rows[0].id;

      // First claim succeeds with locker_id
      const claimRes = await pool.query(
        "INSERT INTO pickup_claims (order_id, locker_id) VALUES ($1, $2) RETURNING id, locker_id, claimed_at",
        [orderId, "locker_A12"],
      );
      expect(claimRes.rows[0].locker_id).toBe("locker_A12");
      expect(claimRes.rows[0].claimed_at).toBeDefined();

      // Second claim on same order fails unique constraint
      await expect(
        pool.query(
          "INSERT INTO pickup_claims (order_id, locker_id) VALUES ($1, $2)",
          [orderId, "locker_B04"],
        ),
      ).rejects.toThrow(/unique constraint|pickup_claims_order_id_key/i);
    });
  });
});
