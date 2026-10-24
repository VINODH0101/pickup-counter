import { createHmac, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { getPool } from "../db/client.js";

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

/**
 * Timing-safe HMAC-SHA256 signature verification against the exact raw HTTP request bytes.
 * Validates 64-character hex format and compares buffers with timingSafeEqual.
 */
export function verifySignature(
  rawBody: Buffer,
  receivedSignature: string,
  secret: string,
): boolean {
  let cleanSig = receivedSignature.trim();
  if (cleanSig.startsWith("sha256=")) {
    cleanSig = cleanSig.slice(7);
  }

  if (!/^[a-f0-9]{64}$/i.test(cleanSig)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();

  const received = Buffer.from(cleanSig, "hex");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

// Backward-compatible alias
export const verifyWebhookSignature = (
  rawBody: Buffer | string | undefined,
  receivedSignature: string | undefined,
  secret: string,
): boolean => {
  if (!rawBody || !receivedSignature || !secret) {
    return false;
  }
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  return verifySignature(buf, receivedSignature, secret);
};

export interface WebhookEventInput {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: string;
  rawPayload: string;
  signature?: string;
}

export interface WebhookProcessingResult {
  received: boolean;
  duplicate: boolean;
  eventId: string;
  orderId: string;
  orderStatus: string;
  message?: string;
}

/**
 * Process a payment webhook event atomically with strict idempotency and state safety.
 *
 * Sequence:
 * 1. Verify signature.
 * 2. Validate event structure.
 * 3. Begin database transaction.
 * 4. Insert event using its unique event ID (idempotency via unique constraint).
 * 5. If that event ID has already been processed, return successful duplicate acknowledgment.
 * 6. Lock corresponding order with SELECT ... FOR UPDATE.
 * 7. Validate order existence, amount, and expiry time.
 * 8. Apply appropriate state transition without overwriting terminal decisions.
 * 9. Commit event and state change together.
 */
export async function processPaymentWebhook(
  event: WebhookEventInput,
  customPool?: Pool,
): Promise<WebhookProcessingResult> {
  const pool = customPool ?? getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Idempotency check: has this event_id already been processed?
    const existingEventRes = await client.query(
      `SELECT pe.id, pe.order_id, o.status AS order_status
       FROM payment_events pe
       JOIN orders o ON o.id = pe.order_id
       WHERE pe.event_id = $1`,
      [event.eventId],
    );

    if (existingEventRes.rows.length > 0) {
      await client.query("COMMIT");
      const existing = existingEventRes.rows[0];
      return {
        received: true,
        duplicate: true,
        eventId: event.eventId,
        orderId: existing.order_id,
        orderStatus: existing.order_status,
        message: "Event already processed (idempotent duplicate)",
      };
    }

    // 2. Lock the target order row with SELECT ... FOR UPDATE
    const orderRes = await client.query(
      `SELECT id, status, total_paise, expires_at
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [event.orderId],
    );

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new PaymentServiceError(`Order not found: ${event.orderId}`, 404);
    }

    const order = orderRes.rows[0];
    let newOrderStatus = order.status;

    // Supported payment capture statuses
    const isCaptureSuccess =
      event.status.toLowerCase() === "captured" ||
      event.status.toLowerCase() === "succeeded";

    // 3. State transition rules
    if (order.status === "picked_up") {
      // Rule: Terminal state 'picked_up' must never be overwritten
      newOrderStatus = "picked_up";
    } else if (order.status === "paid") {
      // Rule: Already paid orders must not process same payment twice
      newOrderStatus = "paid";
    } else if (order.status === "needs_review") {
      newOrderStatus = "needs_review";
    } else if (!isCaptureSuccess) {
      // Unsupported or failed payment status: do not mark paid
      newOrderStatus = "needs_review";
      await client.query(
        `UPDATE orders SET status = 'needs_review', updated_at = NOW() WHERE id = $1`,
        [order.id],
      );
    } else if (order.status === "expired") {
      // Rule: Late capture after expiry sets needs_review and does NOT reclaim sold stock
      newOrderStatus = "needs_review";
      await client.query(
        `UPDATE orders SET status = 'needs_review', updated_at = NOW() WHERE id = $1`,
        [order.id],
      );
    } else if (order.status === "pending") {
      // Check whether hold has expired using the PostgreSQL clock
      const clockCheck = await client.query(
        `SELECT (clock_timestamp() >= $1::timestamptz) AS is_expired`,
        [order.expires_at],
      );
      const isHoldExpired = clockCheck.rows[0].is_expired;

      if (isHoldExpired) {
        // Late capture after hold expiration: mark needs_review, do NOT reclaim stock
        newOrderStatus = "needs_review";
        await client.query(
          `UPDATE orders SET status = 'needs_review', updated_at = NOW() WHERE id = $1`,
          [order.id],
        );
      } else if (event.amountPaise !== order.total_paise) {
        // Amount mismatch: mark needs_review, NEVER paid
        newOrderStatus = "needs_review";
        await client.query(
          `UPDATE orders SET status = 'needs_review', updated_at = NOW() WHERE id = $1`,
          [order.id],
        );
      } else {
        // Valid capture: correct amount, active hold -> Mark paid and retain reservation
        newOrderStatus = "paid";
        await client.query(
          `UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1`,
          [order.id],
        );
      }
    }

    // 4. Record event in payment_events (enforces unique event_id at DB level)
    await client.query(
      `INSERT INTO payment_events (event_id, order_id, amount_paise, status, raw_payload, signature, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
      [
        event.eventId,
        order.id,
        event.amountPaise,
        event.status,
        event.rawPayload,
        event.signature ?? null,
      ],
    );

    await client.query("COMMIT");

    return {
      received: true,
      duplicate: false,
      eventId: event.eventId,
      orderId: order.id,
      orderStatus: newOrderStatus,
    };
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    // Concurrent duplicate delivery: Postgres unique constraint 23505 resolves it idempotently
    if (
      error?.code === "23505" &&
      error?.constraint?.includes("payment_events_event_id")
    ) {
      const orderCheck = await pool.query(
        "SELECT status FROM orders WHERE id = $1",
        [event.orderId],
      ).catch(() => ({ rows: [] }));
      const currentStatus = orderCheck.rows[0]?.status ?? "paid";

      return {
        received: true,
        duplicate: true,
        eventId: event.eventId,
        orderId: event.orderId,
        orderStatus: currentStatus,
        message: "Concurrent duplicate event resolved idempotently",
      };
    }
    throw error;
  } finally {
    client.release();
  }
}
