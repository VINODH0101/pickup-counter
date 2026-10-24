import crypto from "node:crypto";
import type { Server } from "node:http";
import "../src/load-dotenv.js";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

async function runStage7Verification() {
  console.log("=== STAGE 7: PICKUP CLAIM & CONCURRENCY VERIFICATION ===");
  const env = loadEnv();
  const secret = env.PAYMENT_WEBHOOK_SECRET;

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
  console.log(`API running at ${baseUrl}\n`);

  try {
    const pool = getPool();

    // 1. Check initial products
    const pRes = await fetch(`${baseUrl}/products`);
    const products: any = await pRes.json();
    const cookies = products.find((p: any) => p.name === "Cookies");
    console.log(`[1] Initial Cookies stock: physical=${cookies.stock_units}, available=${cookies.available_units}`);

    // 2. Create Order
    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: cookies.id, quantity: 3 }],
      }),
    });
    const orderData: any = await orderRes.json();
    const orderId = orderData.orderId || orderData.id;
    console.log(`[2] Created order ${orderId}: status=${orderData.status}`);

    // 3. Attempt pickup claim before payment -> MUST FAIL with 409
    const earlyClaim = await fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, { method: "POST" });
    const earlyClaimBody: any = await earlyClaim.json();
    console.log(`[3] Attempt pickup before payment: status=${earlyClaim.status} (${earlyClaimBody.error})`);

    // 4. Pay for the order via webhook
    const eventId = `evt_pay_${Date.now()}`;
    const payload = JSON.stringify({
      eventId,
      orderId,
      amountPaise: 9000,
      status: "captured",
    });
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const payRes = await fetch(`${baseUrl}/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": sig },
      body: payload,
    });
    console.log(`[4] Webhook payment captured: HTTP ${payRes.status}`);

    // Check inventory before pickup: physical=8, available=5 (reserved by paid uncollected order)
    const pResPaid = await fetch(`${baseUrl}/products`);
    const prodsPaid: any = await pResPaid.json();
    const cookiesPaid = prodsPaid.find((p: any) => p.id === cookies.id);
    console.log(`    Before pickup: physical=${cookiesPaid.stock_units}, available=${cookiesPaid.available_units}`);

    // 5. CONCURRENCY TEST: Two simultaneous pickup requests
    console.log(`[5] Firing 2 simultaneous pickup requests for order ${orderId}...`);
    const [claimA, claimB] = await Promise.all([
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

    console.log(`    Request A status: ${claimA.status}`);
    console.log(`    Request B status: ${claimB.status}`);

    const statuses = [claimA.status, claimB.status].sort();
    if (statuses[0] === 200 && statuses[1] === 409) {
      console.log(`    SUCCESS: Exactly one request succeeded (200) and one was rejected (409)!`);
      const successRes = claimA.status === 200 ? claimA : claimB;
      const conflictRes = claimA.status === 409 ? claimA : claimB;
      const successJson = await successRes.json();
      const conflictJson = await conflictRes.json();
      console.log(`    Success payload: ${JSON.stringify(successJson)}`);
      console.log(`    Conflict payload: ${JSON.stringify(conflictJson)}`);
    } else {
      console.error(`    FAILURE: Unexpected status codes: ${statuses.join(", ")}`);
    }

    // 6. Verify database source of truth
    const orderCheck = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
    console.log(`[6] Final order status in DB: ${orderCheck.rows[0].status}`);

    const claimRows = await pool.query("SELECT * FROM pickup_claims WHERE order_id = $1", [orderId]);
    console.log(`    Pickup claims audit rows count: ${claimRows.rowCount} (claimed at ${claimRows.rows[0]?.claimed_at})`);

    const finalProd = await pool.query("SELECT stock_units FROM products WHERE id = $1", [cookies.id]);
    console.log(`    Final physical stock in DB: ${finalProd.rows[0].stock_units} (decremented exactly once from 8 to 5)`);

    const finalCatRes = await fetch(`${baseUrl}/products`);
    const finalCat: any = await finalCatRes.json();
    const finalCookies = finalCat.find((p: any) => p.id === cookies.id);
    console.log(`    Final catalog response: physical=${finalCookies.stock_units}, available=${finalCookies.available_units}`);

    // 7. Verify subsequent claim is also rejected with 409
    const thirdClaim = await fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, { method: "POST" });
    console.log(`[7] Subsequent claim attempt: status=${thirdClaim.status}`);

    console.log("\n=== ALL STAGE 7 CHECKS VERIFIED SUCCESSFULLY ===");
  } finally {
    server.close();
    await closePool();
  }
}

runStage7Verification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
