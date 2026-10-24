import { Pool } from "pg";
import { getPool } from "../db/client.js";

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface OrderItemSnapshot {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
}

export interface OrderResult {
  orderId: string;
  id: string;
  status: "pending" | "paid" | "picked_up" | "expired" | "needs_review";
  totalPaise: number;
  total_paise: number;
  items: OrderItemSnapshot[];
  created_at: string;
  expires_at: string;
  expiresInSeconds: number;
}

export class OrderServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "OrderServiceError";
  }
}

/**
 * Creates an order with concurrency-safe stock reservation.
 *
 * Concurrency & Locking Strategy:
 * 1. Product IDs are sorted in deterministic (ascending) order.
 * 2. Product rows are locked with `SELECT ... FOR UPDATE` in this deterministic order,
 *    preventing deadlocks between concurrent multi-item checkout transactions.
 * 3. Available stock is calculated under the lock as:
 *    available = physical stock - active unpaid holds (pending && expires_at > clock_timestamp()) - paid uncollected.
 * 4. All items are verified before any insertion. If any product has insufficient stock,
 *    the entire transaction is rolled back immediately.
 * 5. Unit prices are read exclusively from PostgreSQL (never trusted from client) and snapshotted.
 * 6. A 120-second hold is established using the database clock (`clock_timestamp() + INTERVAL '120 seconds'`).
 * 7. `expiresInSeconds` is measured immediately before returning.
 */
export async function createOrder(
  itemsInput: OrderItemInput[],
  customPool?: Pool,
): Promise<OrderResult> {
  if (!itemsInput || itemsInput.length === 0) {
    throw new OrderServiceError("Order must contain at least one item", 400);
  }

  // 1. Consolidate duplicate product IDs and sum their requested quantities
  const consolidatedMap = new Map<string, number>();
  for (const item of itemsInput) {
    if (!item.productId || typeof item.productId !== "string") {
      throw new OrderServiceError("Invalid productId", 400);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new OrderServiceError(
        `Quantity for product ${item.productId} must be a positive integer`,
        400,
      );
    }
    const current = consolidatedMap.get(item.productId) ?? 0;
    consolidatedMap.set(item.productId, current + item.quantity);
  }

  // 2. Deterministic order of product IDs (prevents deadlocks between concurrent transactions)
  const sortedProductIds = Array.from(consolidatedMap.keys()).sort();

  const pool = customPool ?? getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 3. Lock product rows in deterministic order
    const productsRes = await client.query(
      `SELECT id, name, price_paise, stock_units
       FROM products
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [sortedProductIds],
    );

    // Verify all requested products exist
    if (productsRes.rows.length !== sortedProductIds.length) {
      await client.query("ROLLBACK");
      const foundIds = new Set(productsRes.rows.map((r) => r.id));
      const missingIds = sortedProductIds.filter((id) => !foundIds.has(id));
      throw new OrderServiceError(
        `Product not found: ${missingIds.join(", ")}`,
        404,
      );
    }

    const productMap = new Map<
      string,
      { id: string; name: string; price_paise: number; stock_units: number }
    >(productsRes.rows.map((r) => [r.id, r]));

    // 4. Compute active holds and paid uncollected orders under the product lock
    const holdsRes = await client.query(
      `SELECT oi.product_id, SUM(oi.quantity)::integer AS held_quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = ANY($1::uuid[])
         AND (
           (o.status = 'pending' AND o.expires_at > clock_timestamp())
           OR o.status = 'paid'
         )
       GROUP BY oi.product_id`,
      [sortedProductIds],
    );

    const heldMap = new Map<string, number>();
    for (const row of holdsRes.rows) {
      heldMap.set(row.product_id, row.held_quantity);
    }

    // 5. Check all items for sufficient available stock before any insertion
    for (const [productId, requestedQty] of consolidatedMap.entries()) {
      const product = productMap.get(productId)!;
      const held = heldMap.get(productId) ?? 0;
      const available = product.stock_units - held;

      if (available < requestedQty) {
        // Roll back all changes if any requested product lacks stock
        await client.query("ROLLBACK");
        throw new OrderServiceError(
          `Insufficient stock for product '${product.name}'. Available: ${Math.max(0, available)}, requested: ${requestedQty}`,
          409,
        );
      }
    }

    // 6. Calculate total using integer arithmetic and PostgreSQL prices
    let totalPaise = 0;
    const itemSnapshots: OrderItemSnapshot[] = [];
    for (const [productId, quantity] of consolidatedMap.entries()) {
      const product = productMap.get(productId)!;
      const unitPricePaise = product.price_paise;
      const subtotalPaise = unitPricePaise * quantity;
      totalPaise += subtotalPaise;

      itemSnapshots.push({
        product_id: productId,
        product_name: product.name,
        quantity,
        unit_price_paise: unitPricePaise,
        subtotal_paise: subtotalPaise,
      });
    }

    // 7. Create a 120-second hold using the database clock
    const orderRes = await client.query(
      `INSERT INTO orders (status, total_paise, expires_at)
       VALUES ('pending', $1, clock_timestamp() + INTERVAL '120 seconds')
       RETURNING id, status, total_paise, created_at, expires_at`,
      [totalPaise],
    );
    const orderRow = orderRes.rows[0];

    // 8. Snapshot unit prices into order_items
    for (const item of itemSnapshots) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4)`,
        [orderRow.id, item.product_id, item.quantity, item.unit_price_paise],
      );
    }

    await client.query("COMMIT");

    // 9. Measure expiresInSeconds immediately before returning
    const expiresAtMs = new Date(orderRow.expires_at).getTime();
    const expiresInSeconds = Math.max(
      0,
      Math.floor((expiresAtMs - Date.now()) / 1000),
    );

    return {
      orderId: orderRow.id,
      id: orderRow.id,
      status: orderRow.status,
      totalPaise: orderRow.total_paise,
      total_paise: orderRow.total_paise,
      items: itemSnapshots,
      created_at: new Date(orderRow.created_at).toISOString(),
      expires_at: new Date(orderRow.expires_at).toISOString(),
      expiresInSeconds,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transitions stale pending orders to 'expired' status without relying solely on in-memory timers.
 * Serializes state transitions so expiry and payment cannot overwrite each other's valid terminal decisions.
 */
export async function expireStaleOrders(customPool?: Pool): Promise<number> {
  const pool = customPool ?? getPool();
  const res = await pool.query(
    `UPDATE orders
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at <= clock_timestamp()
     RETURNING id`,
  );
  return res.rowCount ?? 0;
}

/**
 * Fetch an order by ID along with its snapshotted items.
 * Ensures the order shows 'expired' when requested after expiry, without overwriting 'paid' or 'picked_up'.
 */
export async function getOrderById(
  orderId: string,
  customPool?: Pool,
): Promise<OrderResult | null> {
  const pool = customPool ?? getPool();

  // Atomically transition order if hold time has passed
  await pool.query(
    `UPDATE orders
     SET status = 'expired', updated_at = NOW()
     WHERE id = $1 AND status = 'pending' AND expires_at <= clock_timestamp()`,
    [orderId],
  );

  const orderRes = await pool.query(
    `SELECT id, status, total_paise, created_at, expires_at
     FROM orders
     WHERE id = $1`,
    [orderId],
  );

  if (orderRes.rows.length === 0) {
    return null;
  }

  const orderRow = orderRes.rows[0];

  const itemsRes = await pool.query(
    `SELECT oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price_paise
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [orderId],
  );

  const expiresAtMs = new Date(orderRow.expires_at).getTime();
  const expiresInSeconds = Math.max(
    0,
    Math.floor((expiresAtMs - Date.now()) / 1000),
  );

  return {
    orderId: orderRow.id,
    id: orderRow.id,
    status: orderRow.status,
    totalPaise: orderRow.total_paise,
    total_paise: orderRow.total_paise,
    items: itemsRes.rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      quantity: r.quantity,
      unit_price_paise: r.unit_price_paise,
      subtotal_paise: r.unit_price_paise * r.quantity,
    })),
    created_at: new Date(orderRow.created_at).toISOString(),
    expires_at: new Date(orderRow.expires_at).toISOString(),
    expiresInSeconds,
  };
}
