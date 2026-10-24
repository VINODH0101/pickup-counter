import "../src/load-dotenv.js";
import { closePool, getPool } from "../src/db/client.js";

async function verify() {
  const pool = getPool();

  console.log("=== TABLES IN PUBLIC SCHEMA ===");
  const tables = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.table(tables.rows);

  console.log("\n=== SEEDED PRODUCTS (INTEGER PAISE & STOCK UNITS) ===");
  const products = await pool.query(`
    SELECT id, name, price_paise, stock_units, (price_paise / 100.0)::numeric(10,2) AS price_inr, created_at
    FROM products 
    ORDER BY price_paise ASC;
  `);
  console.table(products.rows);

  console.log("\n=== TABLE COLUMNS & DATA TYPES ===");
  const columns = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);
  console.table(columns.rows);

  console.log("\n=== CHECK CONSTRAINTS ===");
  const constraints = await pool.query(`
    SELECT tc.table_name, tc.constraint_name, cc.check_clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc 
      ON tc.constraint_name = cc.constraint_name
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name;
  `);
  console.table(constraints.rows);

  console.log("\n=== UNIQUE CONSTRAINTS ===");
  const uniqueConstraints = await pool.query(`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
  `);
  console.table(uniqueConstraints.rows);

  console.log("\n=== FOREIGN KEYS ===");
  const foreignKeys = await pool.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;
  `);
  console.table(foreignKeys.rows);

  await closePool();
}

verify().catch(console.error);
