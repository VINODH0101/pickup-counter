import { Pool } from "pg";
import { getPool } from "../db/client.js";

export interface ProductCatalogItem {
  id: string;
  name: string;
  price_paise: number;
  stock_units: number;
  available_units: number;
}

export async function getProducts(
  customPool?: Pool,
): Promise<ProductCatalogItem[]> {
  const pool = customPool ?? getPool();

  // Compute available inventory from:
  // physical stock (products.stock_units)
  // - active unpaid holds (status = 'pending' AND expires_at > clock_timestamp())
  // - paid but uncollected orders (status = 'paid')
  const query = `
    SELECT 
      p.id,
      p.name,
      p.price_paise,
      p.stock_units,
      GREATEST(
        0,
        p.stock_units - COALESCE(
          (
            SELECT SUM(oi.quantity)::integer
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE oi.product_id = p.id
              AND (
                (o.status = 'pending' AND o.expires_at > clock_timestamp())
                OR o.status = 'paid'
              )
          ),
          0
        )
      ) AS available_units
    FROM products p
    ORDER BY p.price_paise ASC;
  `;

  const result = await pool.query(query);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    price_paise: row.price_paise,
    stock_units: row.stock_units,
    available_units: Number(row.available_units),
  }));
}
