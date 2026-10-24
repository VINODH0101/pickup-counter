import { Pool } from "pg";
import { getPool } from "../db/client.js";

export class PickupServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message?: string,
  ) {
    super(message || code);
    this.name = "PickupServiceError";
  }
}

export interface PickupClaimResult {
  success: boolean;
  orderId: string;
  status: "picked_up";
  lockerId: string;
  claimedAt: string;
}

/**
 * Atomically claim an order for pickup at the locker counter.
 *
 * Implements the 10-step atomic transactional flow:
 * 1. Begin a database transaction.
 * 2. Lock the order row with SELECT ... FOR UPDATE.
 * 3. Check that the order is currently paid.
 * 4. Reject unpaid, expired, already picked-up, or review-required orders.
 * 5. Verify that sufficient physical stock remains.
 * 6. Decrement stock for every item in the order.
 * 7. Change the order status to picked_up.
 * 8. Insert the pickup audit record into pickup_claims.
 * 9. Commit the transaction.
 * 10. Return success.
 */
export async function claimPickup(
  orderId: string,
  lockerId: string = "locker_01",
  customPool?: Pool,
): Promise<PickupClaimResult> {
  const pool = customPool ?? getPool();
  const client = await pool.connect();

  try {
    // 1. Begin a database transaction
    await client.query("BEGIN");

    // 2. Lock the order row with SELECT ... FOR UPDATE
    const orderRes = await client.query(
      `SELECT id, status
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId],
    );

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new PickupServiceError("ORDER_NOT_FOUND", 404, `Order not found: ${orderId}`);
    }

    const order = orderRes.rows[0];

    // 3 & 4. Check that order is paid; reject unpaid, expired, picked-up, or review-required
    if (order.status !== "paid") {
      await client.query("ROLLBACK");
      if (order.status === "picked_up") {
        throw new PickupServiceError(
          "ORDER_ALREADY_CLAIMED",
          409,
          "Order has already been picked up (already claimed)",
        );
      }
      if (order.status === "pending") {
        throw new PickupServiceError(
          "ORDER_NOT_PAID",
          409,
          "Cannot claim unpaid order. Payment is still pending",
        );
      }
      if (order.status === "expired") {
        throw new PickupServiceError(
          "ORDER_EXPIRED",
          409,
          "Cannot claim expired order",
        );
      }
      if (order.status === "needs_review") {
        throw new PickupServiceError(
          "ORDER_NEEDS_REVIEW",
          409,
          "Cannot claim order requiring reconciliation (needs_review)",
        );
      }
      throw new PickupServiceError(
        "INVALID_ORDER_STATUS",
        409,
        `Cannot claim order with status '${order.status}'`,
      );
    }

    // Fetch line items for the order
    const itemsRes = await client.query(
      `SELECT product_id, quantity
       FROM order_items
       WHERE order_id = $1
       ORDER BY product_id ASC`,
      [orderId],
    );

    const productIds = itemsRes.rows.map((r) => r.product_id);

    // 5. Verify that sufficient physical stock remains (lock products deterministically)
    const prodRes = await client.query(
      `SELECT id, stock_units
       FROM products
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [productIds],
    );

    const stockMap = new Map<string, number>(
      prodRes.rows.map((r) => [r.id, r.stock_units]),
    );

    for (const item of itemsRes.rows) {
      const currentStock = stockMap.get(item.product_id);
      if (currentStock === undefined) {
        await client.query("ROLLBACK");
        throw new PickupServiceError(
          "PRODUCT_NOT_FOUND",
          404,
          `Product not found: ${item.product_id}`,
        );
      }
      if (currentStock < item.quantity) {
        await client.query("ROLLBACK");
        throw new PickupServiceError(
          "INSUFFICIENT_STOCK",
          409,
          `Insufficient physical stock for product ${item.product_id}: requested ${item.quantity}, available ${currentStock}`,
        );
      }
    }

    // 6. Decrement stock for every item in the order
    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE products
         SET stock_units = stock_units - $1, updated_at = NOW()
         WHERE id = $2`,
        [item.quantity, item.product_id],
      );
    }

    // 7. Change order status to picked_up
    await client.query(
      `UPDATE orders
       SET status = 'picked_up', updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );

    // 8. Insert pickup audit record into pickup_claims
    const claimRes = await client.query(
      `INSERT INTO pickup_claims (order_id, locker_id, claimed_at)
       VALUES ($1, $2, clock_timestamp())
       RETURNING id, order_id, locker_id, claimed_at`,
      [orderId, lockerId],
    );

    // 9. Commit the transaction
    await client.query("COMMIT");

    const claimRow = claimRes.rows[0];

    // 10. Return success
    return {
      success: true,
      orderId: claimRow.order_id,
      status: "picked_up",
      lockerId: claimRow.locker_id,
      claimedAt: new Date(claimRow.claimed_at).toISOString(),
    };
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    // Unique constraint on pickup_claims.order_id as safety net
    if (
      error?.code === "23505" &&
      error?.constraint?.includes("pickup_claims_order_id")
    ) {
      throw new PickupServiceError(
        "ORDER_ALREADY_CLAIMED",
        409,
        "Order has already been claimed",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
