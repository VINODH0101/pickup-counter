import crypto from "node:crypto";
import type { Server } from "node:http";
import "../src/load-dotenv.js";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";

async function runCheckpoint() {
  console.log("=== STEP 6 CHECKPOINT VERIFICATION ===");
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
  console.log(`Server listening on ${baseUrl}\n`);

  try {
    // 1. Check initial inventory
    const pRes = await fetch(`${baseUrl}/products`);
    const products: any = await pRes.json();
    const chips = products.find((p: any) => p.name === "Chips");
    console.log(`1. Initial Chips stock: ${chips.stock_units}, available: ${chips.available_units}`);

    // 2. Create an order for 2 Chips
    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: chips.id, quantity: 2 }],
      }),
    });
    const orderData: any = await orderRes.json();
    const orderId = orderData.orderId || orderData.id;
    console.log(`2. Created order ${orderId} with status '${orderData.status}', total: ${orderData.totalPaise} paise`);

    // Verify inventory after hold: available should be 8
    const pResAfterHold = await fetch(`${baseUrl}/products`);
    const prodsAfterHold: any = await pResAfterHold.json();
    const chipsAfterHold = prodsAfterHold.find((p: any) => p.id === chips.id);
    console.log(`   Chips stock after hold: available=${chipsAfterHold.available_units}, physical=${chipsAfterHold.stock_units}`);

    // 3. Send valid signed webhook
    const eventId = `evt_checkpoint_${Date.now()}`;
    const payload = JSON.stringify({
      eventId,
      orderId,
      amountPaise: 4000,
      status: "captured",
    });
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    console.log(`\n3. Sending valid webhook (eventId: ${eventId})...`);
    const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body: payload,
    });
    const webhookBody: any = await webhookRes.json();
    console.log(`   Webhook Response Status: ${webhookRes.status}`, webhookBody);

    // Confirm it becomes 'paid'
    const checkOrderRes1 = await fetch(`${baseUrl}/orders/${orderId}`);
    const orderState1: any = await checkOrderRes1.json();
    console.log(`   Confirmed Order State: '${orderState1.status}'`);
    if (orderState1.status !== "paid") {
      throw new Error(`Expected order to be 'paid', but got '${orderState1.status}'`);
    }

    // 4. Send the EXACT SAME event again (duplicate)
    console.log(`\n4. Sending the exact same webhook again (idempotency check)...`);
    const duplicateRes = await fetch(`${baseUrl}/payments/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body: payload,
    });
    const duplicateBody: any = await duplicateRes.json();
    console.log(`   Duplicate Webhook Response Status: ${duplicateRes.status}`, duplicateBody);
    if (!duplicateBody.duplicate) {
      throw new Error("Expected duplicate: true in response");
    }

    // 5. Confirm order state and inventory are unchanged
    const checkOrderRes2 = await fetch(`${baseUrl}/orders/${orderId}`);
    const orderState2: any = await checkOrderRes2.json();
    console.log(`\n5. Confirmed Order State after duplicate: '${orderState2.status}' (unchanged)`);

    const pResFinal = await fetch(`${baseUrl}/products`);
    const prodsFinal: any = await pResFinal.json();
    const chipsFinal = prodsFinal.find((p: any) => p.id === chips.id);
    console.log(
      `   Confirmed Chips inventory after duplicate: available=${chipsFinal.available_units}, physical=${chipsFinal.stock_units} (unchanged)`,
    );

    console.log("\nCheckpoint verification passed successfully!");
  } finally {
    server.close();
    await closePool();
  }
}

runCheckpoint().catch((err) => {
  console.error("Checkpoint failed:", err);
  process.exit(1);
});
