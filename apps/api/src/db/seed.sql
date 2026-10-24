-- Deterministic Seed Data for Five Products
-- Prices stored in integer paise (₹1 = 100 paise)
INSERT INTO products (id, name, price_paise, stock_units, updated_at)
VALUES
    ('00000000-0000-4000-8000-000000000001', 'Chips', 2000, 10, NOW()),
    ('00000000-0000-4000-8000-000000000002', 'Cookies', 3000, 8, NOW()),
    ('00000000-0000-4000-8000-000000000003', 'Chocolate bar', 2500, 12, NOW()),
    ('00000000-0000-4000-8000-000000000004', 'Juice', 4500, 6, NOW()),
    ('00000000-0000-4000-8000-000000000005', 'Water bottle', 1500, 10, NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_paise = EXCLUDED.price_paise,
    stock_units = EXCLUDED.stock_units,
    updated_at = NOW();
