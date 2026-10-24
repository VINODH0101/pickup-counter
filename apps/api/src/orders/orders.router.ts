import { Router } from "express";
import { z } from "zod";
import { claimPickup, PickupServiceError } from "../pickup/pickup.service.js";
import {
  createOrder,
  getOrderById,
  OrderServiceError,
} from "./orders.service.js";

export const ordersRouter = Router();

const orderItemSchema = z.object({
  productId: z.string().uuid({ message: "productId must be a valid UUID" }),
  quantity: z
    .number()
    .int({ message: "quantity must be an integer" })
    .positive({ message: "quantity must be greater than 0" }),
});

const createOrderSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, { message: "items array must contain at least one item" }),
});

ordersRouter.post("/", async (req, res, next) => {
  try {
    const parseResult = createOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      const details = parseResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      res.status(400).json({ error: `Validation failed: ${details}` });
      return;
    }

    const order = await createOrder(parseResult.data.items);
    res.status(201).json(order);
  } catch (error) {
    if (error instanceof OrderServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(order);
  } catch (error) {
    next(error);
  }
});

ordersRouter.post("/:id/pickup-claim", async (req, res, next) => {
  try {
    const lockerId = req.body?.lockerId || req.body?.locker_id || "locker_01";
    const result = await claimPickup(req.params.id, lockerId);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PickupServiceError) {
      res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    next(error);
  }
});
