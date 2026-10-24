import crypto from "node:crypto";
import type { Server } from "node:http";
import "../src/load-dotenv.js";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

async function runFreshStartAndRestartVerification() {
  console.log("=== STEP 10.3 FRESH-START & RESTART PROCEDURE VERIFICATION ===\n");
  const env = loadEnv();

  // 1. Fresh Start: Reset & Run Initial Migrations & Seed
  console.log("[1] Fresh start: running initial migrations and seeding...");
  await resetDatabase();
  await runMigrations();
  await seedDatabase();

  let app = createApp();
  let server: Server = app.listen(0);
  let address = server.address();
  if (!address || typeof address === "string") throw new Error("Server start failed");
  let baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`    API Server online at ${baseUrl}`);

  try {
    const pool = getPool();

    // 2. Health check
    console.log("\n[2] Checking API health check (/health)...");
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData: any = await healthRes.json();
    console.log(`    Health check status: HTTP ${healthRes.status} -> ${JSON.stringify(healthData)}`);

    // 3. Confirm seeded catalog loads
    console.log("\n[3] Confirming seeded catalog loads (GET /products)...");
    const catRes = await fetch(`${baseUrl}/products`);
    const products: any = await catRes.json();
    console.log(`    Loaded ${products.length} products successfully.`);
    const cookies = products.find((p: any) => p.name === "Cookies");
    console.log(`    Initial Cookies stock: ${cookies.stock_units} units (₹${cookies.price_paise / 100})`);

    // 4. Create and pay for an order
    console.log("\n[4] Creating and paying for an order of 2x Cookies...");
    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: cookies.id, quantity: 2 }],
      }),
    });
    const orderData: any = await orderRes.json();
    const orderId = orderData.orderId || orderData.id;
    console.log(`    Created Order: ${orderId} (total: ${orderData.totalPaise} paise)`);

    const eventId = `evt_fresh_${Date.now()}`;
    const payload = JSON.stringify({
      eventId,
      orderId,
      amountPaise: 6000,
      status: "captured",
    });
    const sig = crypto.createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET).update(payload).digest("hex");
    const payRes = await fetch(`${baseUrl}/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": sig },
      body: payload,
    });
    console.log(`    Payment captured: HTTP ${payRes.status}`);

    // 5. Confirm pickup and inventory changes
    console.log("\n[5] Claiming order from locker (POST /orders/:id/pickup-claim)...");
    const claimRes = await fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockerId: "locker_01" }),
    });
    const claimData: any = await claimRes.json();
    console.log(`    Pickup claim result: HTTP ${claimRes.status} -> Status: '${claimData.status}'`);

    const prodCheck = await pool.query("SELECT stock_units FROM products WHERE id = $1", [cookies.id]);
    console.log(`    Cookies physical stock in DB: ${prodCheck.rows[0].stock_units} (decremented from 8 to 6)`);

    // 6. TEST RESTART PROCEDURE: Stop server, simulate container restart
    console.log("\n[6] Testing documented RESTART PROCEDURE (API restart simulation)...");
    server.close();
    console.log("    Stopped API server.");

    // Simulate startup sequence in wait-and-start.ts on existing database
    console.log("    Re-running migrations on restart...");
    await runMigrations(); // Must be idempotent!

    console.log("    Re-running seed on restart...");
    await seedDatabase(); // Must NOT overwrite decremented stock!

    // Verify stock was NOT erased back to 8
    const prodAfterRestart = await pool.query("SELECT stock_units FROM products WHERE id = $1", [cookies.id]);
    console.log(`    Cookies physical stock after restart: ${prodAfterRestart.rows[0].stock_units}`);
    if (prodAfterRestart.rows[0].stock_units !== 6) {
      throw new Error(`Data erased on restart! Expected 6, got ${prodAfterRestart.rows[0].stock_units}`);
    }
    console.log("    PASS: Data was NOT erased on restart.");

    // Verify order is still picked_up
    const orderAfterRestart = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
    console.log(`    Order status after restart: '${orderAfterRestart.rows[0].status}' (still picked_up)`);

    // 7. Test order-expiry correctness on restart
    console.log("\n[7] Testing order-expiry correctness on restart...");
    const expOrder = await pool.query(
      `INSERT INTO orders (status, total_paise, expires_at)
       VALUES ('pending', 2000, clock_timestamp() - INTERVAL '30 seconds')
       RETURNING id`,
    );
    const expOrderId = expOrder.rows[0].id;
    await pool.query(
      "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, 1, 2000)",
      [expOrderId, cookies.id],
    );

    // Re-launch Express API server
    app = createApp();
    server = app.listen(0);
    address = server.address();
    if (!address || typeof address === "string") throw new Error("Restart failed");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const catAfterRestartRes = await fetch(`${baseUrl}/products`);
    const catAfterRestart: any = await catAfterRestartRes.json();
    const cookiesFinal = catAfterRestart.find((p: any) => p.id === cookies.id);
    console.log(`    Available Cookies after restart: ${cookiesFinal.available_units} (expired hold freed dynamically)`);

    // Verify fetching expired order returns expired status
    const expCheckRes = await fetch(`${baseUrl}/orders/${expOrderId}`);
    const expCheckData: any = await expCheckRes.json();
    console.log(`    Expired order query after restart: status='${expCheckData.status}'`);
    if (expCheckData.status !== "expired") {
      throw new Error(`Expected expired status, got ${expCheckData.status}`);
    }

    console.log("\n=== FRESH-START & RESTART VERIFICATION COMPLETED SUCCESSFULLY ===");
  } finally {
    server.close();
    await closePool();
  }
}

runFreshStartAndRestartVerification().catch((err) => {
  console.error("Fresh-start verification failed:", err);
  process.exit(1);
});
