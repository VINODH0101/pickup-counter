import crypto from "node:crypto";
import "../load-dotenv.js";
import { loadEnv } from "../env.js";

export async function sendWebhook(options?: {
  orderId?: string;
  amountPaise?: number;
  eventId?: string;
  status?: string;
  port?: number;
  secret?: string;
}) {
  const env = loadEnv();
  const port = options?.port || (process.env.PORT ? Number(process.env.PORT) : env.PORT);
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = options?.secret || process.env.PAYMENT_WEBHOOK_SECRET || env.PAYMENT_WEBHOOK_SECRET;

  console.log("=== WEBHOOK SIMULATOR ===");
  console.log(`Target: ${baseUrl}/payments/webhook`);

  let orderId = options?.orderId;
  let amountPaise = options?.amountPaise;
  const eventId = options?.eventId || `evt_${Date.now()}`;
  const status = options?.status || "captured";

  // Parse command line arguments if not provided in options
  if (!orderId || amountPaise === undefined) {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--order-id" && args[i + 1]) {
        orderId = args[i + 1];
        i++;
      } else if (args[i] === "--amount" && args[i + 1]) {
        amountPaise = Number(args[i + 1]);
        i++;
      } else if (args[i] === "--status" && args[i + 1]) {
        options = { ...options, status: args[i + 1] };
        i++;
      }
    }
  }

  // If no order ID was provided, create a test order first
  if (!orderId) {
    console.log("No --order-id provided. Creating a test order first...");
    const productsRes = await fetch(`${baseUrl}/products`);
    if (!productsRes.ok) {
      throw new Error(`Failed to fetch products: ${productsRes.statusText}`);
    }
    const products: any = await productsRes.json();
    const chips = products.find((p: any) => p.name === "Chips") || products[0];

    const createOrderRes = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: chips.id, quantity: 1 }],
      }),
    });

    if (!createOrderRes.ok) {
      const err = await createOrderRes.text();
      throw new Error(`Failed to create order: ${err}`);
    }

    const orderData: any = await createOrderRes.json();
    orderId = orderData.orderId || orderData.id;
    amountPaise = orderData.totalPaise || orderData.total_paise;
    console.log(`Created test order ${orderId} for ${amountPaise} paise.`);
  }

  // If orderId is provided but amount is not, query the order directly
  if (orderId && amountPaise === undefined) {
    try {
      const orderRes = await fetch(`${baseUrl}/orders/${orderId}`);
      if (orderRes.ok) {
        const orderData: any = await orderRes.json();
        amountPaise = orderData.totalPaise || orderData.total_paise;
        console.log(`Fetched order total from API: ${amountPaise} paise`);
      }
    } catch {
      // Fallback
    }
  }

  if (amountPaise === undefined) {
    amountPaise = 2000;
  }

  // 1. Construct raw JSON payload bytes
  const payloadObject = {
    eventId,
    orderId,
    amountPaise,
    status,
  };
  const rawBody = JSON.stringify(payloadObject);

  // 2. Generate HMAC-SHA256 signature using the shared secret
  const signature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  console.log("\nOutgoing Webhook Details:");
  console.log(`Event ID: ${eventId}`);
  console.log(`Order ID: ${orderId}`);
  console.log(`Amount: ${amountPaise} paise`);
  console.log(`Status: ${status}`);
  console.log(`X-Signature: ${signature}`);
  console.log(`Raw Body: ${rawBody}`);

  // 3. Send HTTP POST request with X-Signature header
  const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body: rawBody,
  });

  console.log(`\nHTTP Response: ${webhookRes.status} ${webhookRes.statusText}`);
  const responseBody = await webhookRes.json();
  console.log("Response Body:", JSON.stringify(responseBody, null, 2));

  // 4. Verify order state in API
  const verifyRes = await fetch(`${baseUrl}/orders/${orderId}`);
  if (verifyRes.ok) {
    const updatedOrder: any = await verifyRes.json();
    console.log(`Verified Order State in PostgreSQL: ${updatedOrder.status}`);
  }

  return { status: webhookRes.status, body: responseBody };
}

if (process.argv[1]?.includes("send-webhook")) {
  sendWebhook().catch((err) => {
    console.error("Error executing send-webhook:", err);
    process.exit(1);
  });
}
