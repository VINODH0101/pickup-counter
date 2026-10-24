import { Pool } from "pg";
import { getPool } from "./client.js";

export interface SeedProduct {
  id: string;
  name: string;
  price_paise: number;
  stock_units: number;
}

export const SEED_SNACKS: readonly SeedProduct[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Chips",
    price_paise: 2000, // ₹20
    stock_units: 10,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Cookies",
    price_paise: 3000, // ₹30
    stock_units: 8,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Chocolate bar",
    price_paise: 2500, // ₹25
    stock_units: 12,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    name: "Juice",
    price_paise: 4500, // ₹45
    stock_units: 6,
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    name: "Water bottle",
    price_paise: 1500, // ₹15
    stock_units: 10,
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    name: "Roasted Almonds & Cashews",
    price_paise: 6500, // ₹65
    stock_units: 10,
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    name: "Artisanal Dark Chocolate 72%",
    price_paise: 8500, // ₹85
    stock_units: 8,
  },
  {
    id: "00000000-0000-4000-8000-000000000008",
    name: "Sparkling Berry Kombucha",
    price_paise: 7500, // ₹75
    stock_units: 6,
  },
  {
    id: "00000000-0000-4000-8000-000000000009",
    name: "Truffle Potato Crisps",
    price_paise: 4500, // ₹45
    stock_units: 12,
  },
  {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Cold Brew Nitro Coffee",
    price_paise: 8000, // ₹80
    stock_units: 8,
  },
  {
    id: "00000000-0000-4000-8000-000000000011",
    name: "Roasted Peri-Peri Makhana",
    price_paise: 4000, // ₹40
    stock_units: 15,
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    name: "Organic Granola Honey Bar",
    price_paise: 3500, // ₹35
    stock_units: 10,
  },
];

export async function seedDatabase(customPool?: Pool): Promise<void> {
  const pool = customPool ?? getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const snack of SEED_SNACKS) {
      await client.query(
        `
        INSERT INTO products (id, name, price_paise, stock_units, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO NOTHING;
      `,
        [snack.id, snack.name, snack.price_paise, snack.stock_units],
      );
    }

    await client.query("COMMIT");
    console.log(`Successfully seeded ${SEED_SNACKS.length} products.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
