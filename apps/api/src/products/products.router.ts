import { Router } from "express";
import { getProducts } from "./products.service.js";

export const productsRouter = Router();

productsRouter.get("/", async (_req, res, next) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (error) {
    next(error);
  }
});
