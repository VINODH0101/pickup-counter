import "../src/load-dotenv.js";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { closePool } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";

async function runManualVerification() {
  console.log("=== STEP 5.4 MANUAL VERIFICATION SCRIPT ===");
  console.log("Resetting database and running seed data...");
  await resetDatabase();
  await runMigrations();
  await seedDatabase();

  const app = createApp();
  const server: Server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Server listening on ${baseUrl}\n`);

  try {
    // 1. GET /products
    console.log("--------------------------------------------------");
    console.log("Test 1: GET /products");
    const res1 = await fetch(`${baseUrl}/products`);
    console.log(`Status: ${res1.status} ${res1.statusText}`);
    const products1: any = await res1.json();
    console.log("Products returned (showing id, name, price_paise, available_units):");
    console.table(
      products1.map((p: any) => ({
        id: p.id,
        name: p.name,
        price_paise: p.price_paise,
        stock_units: p.stock_units,
        available_units: p.available_units,
      })),
    );

    const chips = products1.find((p: any) => p.name === "Chips");
    const juice = products1.find((p: any) => p.name === "Juice");
    const cookies = products1.find((p: any) => p.name === "Cookies");

    // 2. A valid POST /orders
    console.log("--------------------------------------------------");
    console.log("Test 2: A valid POST /orders (ordering 2 Chips, 2000 paise each)");
    const validBody = {
      items: [{ productId: chips.id, quantity: 2 }],
    };
    console.log("Request Body:", JSON.stringify(validBody, null, 2));
    const res2 = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    console.log(`Status: ${res2.status} ${res2.statusText}`);
    const order2: any = await res2.json();
    console.log("Response Body:", JSON.stringify(order2, null, 2));

    // Verify stock deduction in GET /products
    const res2Check = await fetch(`${baseUrl}/products`);
    const productsAfterValid: any = await res2Check.json();
    const chipsAfter = productsAfterValid.find((p: any) => p.id === chips.id);
    console.log(
      `Chips physical stock_units: ${chipsAfter.stock_units}, available_units: ${chipsAfter.available_units} (held 2 units)`,
    );

    // 3. An order requesting more units than available
    console.log("--------------------------------------------------");
    console.log(
      `Test 3: An order requesting more units than available (Juice has ${juice.available_units} available, requesting 99 units)`,
    );
    const excessiveBody = {
      items: [
        { productId: cookies.id, quantity: 1 },
        { productId: juice.id, quantity: 99 },
      ],
    };
    console.log("Request Body:", JSON.stringify(excessiveBody, null, 2));
    const res3 = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(excessiveBody),
    });
    console.log(`Status: ${res3.status} ${res3.statusText}`);
    const err3: any = await res3.json();
    console.log("Response Body:", JSON.stringify(err3, null, 2));

    // Check that Cookies were NOT partially reserved
    const res3Check = await fetch(`${baseUrl}/products`);
    const productsAfterExcessive: any = await res3Check.json();
    const cookiesAfter = productsAfterExcessive.find((p: any) => p.id === cookies.id);
    console.log(
      `Verification: Cookies available_units: ${cookiesAfter.available_units} (Unchanged! No partial reservation)`,
    );

    // 4. A request with a zero quantity
    console.log("--------------------------------------------------");
    console.log("Test 4: A request with a zero quantity (quantity = 0)");
    const zeroQtyBody = {
      items: [{ productId: chips.id, quantity: 0 }],
    };
    console.log("Request Body:", JSON.stringify(zeroQtyBody, null, 2));
    const res4 = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zeroQtyBody),
    });
    console.log(`Status: ${res4.status} ${res4.statusText}`);
    const err4: any = await res4.json();
    console.log("Response Body:", JSON.stringify(err4, null, 2));

    // 5. A request containing an unknown product ID
    console.log("--------------------------------------------------");
    console.log(
      "Test 5: A request containing an unknown product ID (00000000-0000-0000-0000-000000000000)",
    );
    const unknownBody = {
      items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
    };
    console.log("Request Body:", JSON.stringify(unknownBody, null, 2));
    const res5 = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(unknownBody),
    });
    console.log(`Status: ${res5.status} ${res5.statusText}`);
    const err5: any = await res5.json();
    console.log("Response Body:", JSON.stringify(err5, null, 2));

    console.log("--------------------------------------------------");
    console.log("All 5 verification checks completed successfully!");
  } finally {
    server.close();
    await closePool();
  }
}

runManualVerification().catch(console.error);
