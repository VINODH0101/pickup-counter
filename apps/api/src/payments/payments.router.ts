import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { loadEnv } from "../env.js";
import {
  PaymentServiceError,
  processPaymentWebhook,
  verifyWebhookSignature,
} from "./payments.service.js";

export const paymentsRouter = Router();

const webhookPayloadSchema = z
  .object({
    eventId: z.string().min(1).optional(),
    event_id: z.string().min(1).optional(),
    orderId: z.string().uuid().optional(),
    order_id: z.string().uuid().optional(),
    amountPaise: z.number().int().positive().optional(),
    amount_paise: z.number().int().positive().optional(),
    status: z.string().default("succeeded"),
  })
  .refine((data) => data.eventId || data.event_id, {
    message: "Missing required eventId or event_id",
  })
  .refine((data) => data.orderId || data.order_id, {
    message: "Missing required orderId or order_id",
  })
  .refine((data) => (data.amountPaise ?? data.amount_paise) !== undefined, {
    message: "Missing required amountPaise or amount_paise",
  });

paymentsRouter.post("/webhook", async (req, res, next) => {
  try {
    const env = loadEnv();
    const signatureHeader =
      (req.headers["x-signature"] as string | undefined) ??
      (req.headers["X-Signature"] as string | undefined);

    const rawBody = (req as any).rawBody as Buffer | string | undefined;

    // 1. Verify HMAC-SHA256 signature against the exact raw HTTP body
    const isValidSignature = verifyWebhookSignature(
      rawBody,
      signatureHeader,
      env.PAYMENT_WEBHOOK_SECRET,
    );

    if (!isValidSignature) {
      res.status(401).json({ error: "Invalid or missing webhook signature" });
      return;
    }

    // 2. Validate request payload structure
    const parseResult = webhookPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      const details = parseResult.error.issues
        .map((i) => i.message)
        .join("; ");
      res.status(400).json({ error: `Malformed webhook payload: ${details}` });
      return;
    }

    const payload = parseResult.data;
    const eventId = (payload.eventId ?? payload.event_id)!;
    const orderId = (payload.orderId ?? payload.order_id)!;
    const amountPaise = (payload.amountPaise ?? payload.amount_paise)!;

    const rawPayloadString = Buffer.isBuffer(rawBody)
      ? rawBody.toString("utf8")
      : typeof rawBody === "string"
        ? rawBody
        : JSON.stringify(req.body);

    // 3. Process the payment event atomically and idempotently
    const result = await processPaymentWebhook({
      eventId,
      orderId,
      amountPaise,
      status: payload.status,
      rawPayload: rawPayloadString,
      signature: signatureHeader,
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

paymentsRouter.post("/simulate", async (req, res, next) => {
  try {
    const { orderId, amountPaise, status = "captured" } = req.body ?? {};
    if (!orderId) {
      res.status(400).json({ error: "Missing required orderId" });
      return;
    }
    const env = loadEnv();
    const eventId = `evt_sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const payload = JSON.stringify({
      eventId,
      orderId,
      amountPaise,
      status,
    });
    const signature = crypto
      .createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    const result = await processPaymentWebhook({
      eventId,
      orderId,
      amountPaise: Number(amountPaise),
      status,
      rawPayload: payload,
      signature,
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});
