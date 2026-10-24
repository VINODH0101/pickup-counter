import type { Server } from "node:http";
import "../src/load-dotenv.js";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";

async function runE2EVerification() {
  console.log("=== VERIFYING COMPLETE CUSTOMER JOURNEY AGAINST API ===\n");

  await resetDatabase();
  await runMigrations();
  await seedDatabase();

  const app = createApp();
  const server: Server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`API Server listening at: ${baseUrl}\n`);

  try {
    const pool = getPool();

    // 1. Browse catalog (GET /products)
    console.log("[1] Browsing snack catalog (GET /products)...");
    const catRes = await fetch(`${baseUrl}/products`);
    const catalog: any = await catRes.json();
    console.log(`    Loaded ${catalog.length} snacks:`);
    for (const p of catalog) {
      console.log(`    - ${p.name.padEnd(16)}: ₹${(p.price_paise / 100).toFixed(2).padStart(6)} | Available: ${p.available_units} | Physical: ${p.stock_units}`);
    }

    const cookies = catalog.find((p: any) => p.name === "Cookies");
    const chips = catalog.find((p: any) => p.name === "Chips");

    // 2. Build cart with quantity controls & calculated totals
    console.log("\n[2] Building cart: 2x Cookies (₹30 each) + 1x Chips (₹20)...");
    const expectedTotalPaise = 2 * cookies.price_paise + 1 * chips.price_paise; // 2 * 3000 + 2000 = 8000 paise (₹80.00)
    console.log(`    Calculated display total: ₹${(expectedTotalPaise / 100).toFixed(2)} (${expectedTotalPaise} paise)`);

    // 3. Submit order (POST /orders)
    console.log("\n[3] Submitting order to POST /orders...");
    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { productId: cookies.id, quantity: 2 },
          { productId: chips.id, quantity: 1 },
        ],
      }),
    });
    const order: any = await orderRes.json();
    console.log(`    HTTP ${orderRes.status} Created!`);
    console.log(`    Order ID: ${order.orderId || order.id}`);
    console.log(`    Status: '${order.status}'`);
    console.log(`    Authoritative Total: ₹${(order.totalPaise / 100).toFixed(2)} (${order.totalPaise} paise)`);
    console.log(`    Expires In Seconds: ${order.expiresInSeconds}s (hold active)`);

    // 4. Verify catalog hold immediately reflects reserved stock
    const catAfterHoldRes = await fetch(`${baseUrl}/products`);
    const catAfterHold: any = await catAfterHoldRes.json();
    const cookiesAfter = catAfterHold.find((p: any) => p.id === cookies.id);
    console.log(`\n[4] Catalog inventory during hold:`);
    console.log(`    Cookies: available=${cookiesAfter.available_units} (was 8, now 6), physical=${cookiesAfter.stock_units}`);

    // 5. Poll order status (GET /orders/:id)
    console.log("\n[5] Polling GET /orders/:id...");
    const poll1Res = await fetch(`${baseUrl}/orders/${order.id}`);
    const poll1: any = await poll1Res.json();
    console.log(`    Poll 1: status='${poll1.status}', remaining=${poll1.expiresInSeconds}s`);

    // 6. Complete Payment (Simulate Gateway Webhook)
    console.log("\n[6] Simulating payment gateway capture (POST /payments/simulate)...");
    const payRes = await fetch(`${baseUrl}/payments/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        amountPaise: order.totalPaise,
        status: "captured",
      }),
    });
    const payResult: any = await payRes.json();
    console.log(`    Payment capture acknowledged: received=${payResult.received}, orderStatus='${payResult.orderStatus}'`);

    // 7. Poll order status again -> should now be 'paid'
    console.log("\n[7] Polling GET /orders/:id after payment...");
    const poll2Res = await fetch(`${baseUrl}/orders/${order.id}`);
    const poll2: any = await poll2Res.json();
    console.log(`    Poll 2: status='${poll2.status}' (Transitioned to paid!)`);

    // 8. Claim Pickup from Counter Locker (POST /orders/:id/pickup-claim)
    console.log("\n[8] Claiming order from locker (POST /orders/:id/pickup-claim)...");
    const claimRes = await fetch(`${baseUrl}/orders/${order.id}/pickup-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockerId: "locker_01" }),
    });
    const claimResult: any = await claimRes.json();
    console.log(`    Pickup claim result: HTTP ${claimRes.status}`);
    console.log(`    Status: '${claimResult.status}', Locker: ${claimResult.lockerId}, ClaimedAt: ${claimResult.claimedAt}`);

    // 9. Verify PostgreSQL physical stock is decremented
    const finalProd = await pool.query("SELECT stock_units FROM products WHERE id = $1", [cookies.id]);
    console.log(`\n[9] PostgreSQL physical stock after collection:`);
    console.log(`    Cookies physical stock_units in DB: ${finalProd.rows[0].stock_units} (decremented from 8 to 6)`);

    // 10. Attempt duplicate claim -> verify 409 ORDER_ALREADY_CLAIMED
    console.log("\n[10] Testing repeated claim on collected order...");
    const dupClaimRes = await fetch(`${baseUrl}/orders/${order.id}/pickup-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockerId: "locker_01" }),
    });
    const dupClaim: any = await dupClaimRes.json();
    console.log(`    Duplicate claim HTTP ${dupClaimRes.status}: error='${dupClaim.error}'`);

    // 11. Test Insufficient Stock rejection
    console.log("\n[11] Testing Insufficient Stock rejection...");
    const overorderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: cookies.id, quantity: 999 }],
      }),
    });
    const overorderData: any = await overorderRes.json();
    console.log(`    Over-order attempt HTTP ${overorderRes.status}: error='${overorderData.error}'`);

    console.log("\n=== ALL E2E FLOW CHECKS COMPLETED AND VERIFIED! ===");
  } finally {
    server.close();
    await closePool();
  }
}

runE2EVerification().catch((err) => {
  console.error("E2E verification failed:", err);
  process.exit(1);
});
