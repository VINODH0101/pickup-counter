-- Deterministic Seed Data for Products
-- Prices stored in integer paise (₹1 = 100 paise)
INSERT INTO products (id, name, price_paise, stock_units, updated_at)
VALUES
    ('00000000-0000-4000-8000-000000000001', 'Chips', 2000, 10, NOW()),
    ('00000000-0000-4000-8000-000000000002', 'Cookies', 3000, 8, NOW()),
    ('00000000-0000-4000-8000-000000000003', 'Chocolate bar', 2500, 12, NOW()),
    ('00000000-0000-4000-8000-000000000004', 'Juice', 4500, 6, NOW()),
    ('00000000-0000-4000-8000-000000000005', 'Water bottle', 1500, 10, NOW()),
    ('00000000-0000-4000-8000-000000000006', 'Roasted Almonds & Cashews', 6500, 10, NOW()),
    ('00000000-0000-4000-8000-000000000007', 'Artisanal Dark Chocolate 72%', 8500, 8, NOW()),
    ('00000000-0000-4000-8000-000000000008', 'Sparkling Berry Kombucha', 7500, 6, NOW()),
    ('00000000-0000-4000-8000-000000000009', 'Truffle Potato Crisps', 4500, 12, NOW()),
    ('00000000-0000-4000-8000-000000000010', 'Cold Brew Nitro Coffee', 8000, 8, NOW()),
    ('00000000-0000-4000-8000-000000000011', 'Roasted Peri-Peri Makhana', 4000, 15, NOW()),
    ('00000000-0000-4000-8000-000000000012', 'Organic Granola Honey Bar', 3500, 10, NOW())
ON CONFLICT (id) DO NOTHING;
