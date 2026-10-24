# Pickup Counter

A robust, self-service snack pickup counter application built with **TypeScript**, **Node.js (Express)**, **PostgreSQL**, and **React (Vite)**. Engineered for high concurrency, zero overselling, timing-safe webhook processing, and atomic locker pickup claims.

---

## 1. Project Overview & Architecture

### System Architecture

The application is structured as a TypeScript monorepo with clean separation of concerns between HTTP routes, business services, database persistence, and client presentation:

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer (apps/web)"]
        Browser["React 18 SPA (Vite)<br/>• Monotonic performance.now() Timer<br/>• Safe Polling Hook<br/>• Real-Time Catalog & Cart"]
    end

    subgraph ReverseProxy ["Reverse Proxy (docker/nginx)"]
        Nginx["Nginx Reverse Proxy<br/>• Serves Web Assets on :80<br/>• Proxies /api/* -> api:3001"]
    end

    subgraph ServiceLayer ["API Layer (apps/api)"]
        Router["Express Routers<br/>• /products<br/>• /orders<br/>• /payments"]
        Services["Business Services<br/>• orders.service.ts<br/>• payments.service.ts<br/>• pickup.service.ts"]
    end

    subgraph PersistenceLayer ["Data Layer (PostgreSQL)"]
        Postgres[("PostgreSQL 16 Engine<br/>• orders (FOR UPDATE locking)<br/>• products (stock_units >= 0)<br/>• order_items (price snapshots)<br/>• payment_events (event_id UNIQUE)<br/>• pickup_claims (order_id UNIQUE)")]
    end

    Browser -->|Port 5173| Nginx
    Nginx -->|/api/*| Router
    Router --> Services
    Services --> Postgres
```

### Core Invariants & Engineering Guarantees
- **Integer Paise Representation**: All currency values are strictly stored and computed as integer paise (`₹1 = 100 paise`). Floating-point arithmetic is never used for financial math.
- **Authoritative Database Source of Truth**: Inventory availability, unit prices, order totals, and expiry timestamps are determined by PostgreSQL, never trusted from client payloads.
- **Pessimistic Concurrency Control**: Uses database transactions with `SELECT ... FOR UPDATE` row locks to eliminate overselling and prevent race conditions.
- **Timing-Safe HMAC-SHA256 Webhooks**: Validates webhook signatures using the exact raw HTTP request body bytes and `crypto.timingSafeEqual`.
- **Atomic Locker Claims**: Counter collection atomically decrements physical stock and logs an audit record in a single transaction.

---

## 2. Prerequisites

- **Node.js**: `v20.0.0` or higher
- **npm**: `v10.0.0` or higher
- **Docker & Docker Compose**: Docker Engine `v24+` with Docker Compose `v2+` (optional for local embedded PostgreSQL mode)

---

## 3. Environment Variables & Setup

Configuration is handled through environment variables. A template is provided in [`.env.example`](file:///.env.example).

### Configuration Template

```env
# Node Environment
NODE_ENV=development
PORT=3001

# PostgreSQL Configuration
POSTGRES_DB=pickup_counter
POSTGRES_USER=pickup_user
POSTGRES_PASSWORD=replace_for_local_development

# Database URLs
# For Docker Compose (internal service hostname 'db'):
DATABASE_URL=postgresql://pickup_user:replace_for_local_development@db:5432/pickup_counter
# For local host development:
# DATABASE_URL=postgresql://pickup:pickup@localhost:5432/pickup_counter
TEST_DATABASE_URL=postgresql://pickup:pickup@localhost:5432/pickup_counter_test

# Webhook Secret (HMAC-SHA256)
PAYMENT_WEBHOOK_SECRET=replace_with_a_long_random_secret

# Port Configuration
API_PORT=3001
WEB_PORT=5173
POSTGRES_PORT=5432
```

### Local Setup
1. Clone the repository:
   ```powershell
   git clone <repo-url>
   cd pickup-counter
   ```
2. Copy environment file:
   ```powershell
   copy .env.example .env
   ```
3. Install dependencies:
   ```powershell
   npm install
   ```

---

## 4. One-Command Startup

The complete development application (PostgreSQL, Express API with automatic migrations and seeding, and Nginx-served React frontend) starts with a single command:

```powershell
docker compose up --build
```

### Service Access URLs
- **Customer Web Interface**: [http://localhost:5173](http://localhost:5173)
- **API Health Check**: [http://localhost:3001/health](http://localhost:3001/health) (or via reverse-proxy at [http://localhost:5173/api/health](http://localhost:5173/api/health))
- **PostgreSQL Database**: `localhost:5432` (`db: pickup_counter`)

### Clean Shutdown
```powershell
# Stop services while preserving data volume
docker compose down

# Stop services and purge all data volumes
docker compose down -v
```

### Local Development Without Docker
If developing locally without Docker Desktop, run:
```powershell
# 1. Run migrations & seeds
npm run migrate -w @pickup-counter/api
npm run seed -w @pickup-counter/api

# 2. Launch both API and Web servers concurrently
npm run dev
```

---

## 5. API Endpoints with Example Requests and Responses

### 1. `GET /health`
System health check endpoint.
```http
GET /health HTTP/1.1
```
```json
{
  "status": "ok"
}
```

---

### 2. `GET /products`
Returns snack catalog with live inventory. Available units dynamically subtract active unpaid holds and uncollected paid orders.
```http
GET /products HTTP/1.1
```
```json
[
  {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "Chips",
    "price_paise": 2000,
    "stock_units": 10,
    "available_units": 8
  },
  {
    "id": "00000000-0000-4000-8000-000000000002",
    "name": "Cookies",
    "price_paise": 3000,
    "stock_units": 8,
    "available_units": 8
  }
]
```

---

### 3. `POST /orders`
Creates an order with an authoritative 120-second stock hold. Validates positive integer quantities and consolidates duplicate product lines.

#### Request
```http
POST /orders HTTP/1.1
Content-Type: application/json

{
  "items": [
    { "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1 },
    { "productId": "00000000-0000-4000-8000-000000000002", "quantity": 2 }
  ]
}
```

#### Response (HTTP 201 Created)
```json
{
  "orderId": "5bc6d360-3316-4112-9260-3bb0b69bee90",
  "status": "pending",
  "totalPaise": 8000,
  "expires_at": "2026-10-24T18:32:03.000Z",
  "expiresInSeconds": 120,
  "items": [
    {
      "product_id": "00000000-0000-4000-8000-000000000001",
      "quantity": 1,
      "unit_price_paise": 2000
    },
    {
      "product_id": "00000000-0000-4000-8000-000000000002",
      "quantity": 2,
      "unit_price_paise": 3000
    }
  ]
}
```

#### Insufficient Stock Error (HTTP 409 Conflict)
```json
{
  "error": "Insufficient stock for product 'Cookies'. Available: 1, requested: 2"
}
```

---

### 4. `GET /orders/:id`
Fetches current order status, line items, and real-time hold countdown. Automatically marks orders `expired` if `clock_timestamp() >= expires_at`.

#### Response (HTTP 200 OK)
```json
{
  "orderId": "5bc6d360-3316-4112-9260-3bb0b69bee90",
  "status": "pending",
  "totalPaise": 8000,
  "expiresInSeconds": 98,
  "created_at": "2026-10-24T18:30:03.000Z",
  "expires_at": "2026-10-24T18:32:03.000Z",
  "items": [
    {
      "product_id": "00000000-0000-4000-8000-000000000001",
      "product_name": "Chips",
      "quantity": 1,
      "unit_price_paise": 2000,
      "subtotal_paise": 2000
    }
  ]
}
```

---

### 5. `POST /payments/webhook`
Receives gateway payment events. Validates `X-Signature` HMAC-SHA256 signature against the exact raw HTTP request body buffer.

#### Request
```http
POST /payments/webhook HTTP/1.1
Content-Type: application/json
X-Signature: a1b2c3d4e5f6... (64-char hex HMAC-SHA256)

{
  "eventId": "evt_1729794600123",
  "orderId": "5bc6d360-3316-4112-9260-3bb0b69bee90",
  "amountPaise": 8000,
  "status": "captured"
}
```

#### Success Response (HTTP 200 OK)
```json
{
  "received": true,
  "duplicate": false,
  "eventId": "evt_1729794600123",
  "orderId": "5bc6d360-3316-4112-9260-3bb0b69bee90",
  "orderStatus": "paid"
}
```

#### Duplicate Delivery Response (HTTP 200 OK — Idempotent)
```json
{
  "received": true,
  "duplicate": true,
  "eventId": "evt_1729794600123",
  "orderId": "5bc6d360-3316-4112-9260-3bb0b69bee90",
  "orderStatus": "paid",
  "message": "Event already processed (idempotent duplicate)"
}
```

#### Invalid Signature Response (HTTP 401 Unauthorized)
```json
{
  "error": "Invalid or missing webhook signature"
}
```

---

### 6. `POST /orders/:id/pickup-claim`
Atomically claims an order from the counter locker. Exclusively locks the order row, checks `status === 'paid'`, decrements physical stock, marks order `picked_up`, and inserts an audit log row.

#### Request
```http
POST /orders/5bc6d360-3316-4112-9260-3bb0b69bee90/pickup-claim HTTP/1.1
Content-Type: application/json

{
  "lockerId": "locker_01"
}
```

#### Success Response (HTTP 200 OK)
```json
{
  "success": true,
  "orderId": "5bc6d360-3316-4112-9260-3bb0b69bee90",
  "status": "picked_up",
  "lockerId": "locker_01",
  "claimedAt": "2026-10-24T18:31:15.220Z"
}
```

#### Repeated / Conflict Response (HTTP 409 Conflict)
```json
{
  "error": "ORDER_ALREADY_CLAIMED",
  "message": "Order has already been picked up (already claimed)"
}
```

---

## 6. Database Migrations and Seed Data

### Migrations Architecture
Migrations are SQL files tracked in the `schema_migrations` table. They execute in lexicographical order inside isolated transactions.

| Migration | Content |
| :--- | :--- |
| [`001_init.sql`](file:///apps/api/migrations/001_init.sql) | Enables `pgcrypto` extension for native UUID generation (`gen_random_uuid()`). |
| [`002_create_schema.sql`](file:///apps/api/migrations/002_create_schema.sql) | Creates `products`, `orders`, `order_items`, `payment_events`, `pickup_claims` tables and constraints. |

### Deterministic Seed Data (12 Curated Snacks)

| Product Name | Category | Price (Paise) | Price (₹) | Initial Stock | Deterministic UUID |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Chips** | Savory & Crisps | 2000 | ₹20.00 | 10 | `00000000-0000-4000-8000-000000000001` |
| **Cookies** | Chocolates & Sweets | 3000 | ₹30.00 | 8 | `00000000-0000-4000-8000-000000000002` |
| **Chocolate bar** | Chocolates & Sweets | 2500 | ₹25.00 | 12 | `00000000-0000-4000-8000-000000000003` |
| **Juice** | Cold Beverages | 4500 | ₹45.00 | 6 | `00000000-0000-4000-8000-000000000004` |
| **Water bottle** | Cold Beverages | 1500 | ₹15.00 | 10 | `00000000-0000-4000-8000-000000000005` |
| **Roasted Almonds & Cashews** | Healthy & Energy | 6500 | ₹65.00 | 10 | `00000000-0000-4000-8000-000000000006` |
| **Artisanal Dark Chocolate 72%** | Chocolates & Sweets | 8500 | ₹85.00 | 8 | `00000000-0000-4000-8000-000000000007` |
| **Sparkling Berry Kombucha** | Cold Beverages | 7500 | ₹75.00 | 6 | `00000000-0000-4000-8000-000000000008` |
| **Truffle Potato Crisps** | Savory & Crisps | 4500 | ₹45.00 | 12 | `00000000-0000-4000-8000-000000000009` |
| **Cold Brew Nitro Coffee** | Cold Beverages | 8000 | ₹80.00 | 8 | `00000000-0000-4000-8000-000000000010` |
| **Roasted Peri-Peri Makhana** | Healthy & Energy | 4000 | ₹40.00 | 15 | `00000000-0000-4000-8000-000000000011` |
| **Organic Granola Honey Bar** | Healthy & Energy | 3500 | ₹35.00 | 10 | `00000000-0000-4000-8000-000000000012` |

### Seeding Safety on Restart
Seeding uses `ON CONFLICT (id) DO NOTHING`. Restarting the API container or database re-runs seeds idempotently without overwriting decremented stock or wiping active customer purchases.

```powershell
# Run migrations manually
npm run migrate -w @pickup-counter/api

# Seed catalog manually
npm run seed -w @pickup-counter/api
```

---

## 7. How to Run the Webhook Simulator

The webhook simulator constructs a valid JSON payload, generates the HMAC-SHA256 signature against the exact raw bytes, and delivers it with the `X-Signature` header:

```powershell
# Send webhook for a specific active order (automatically fetches total)
npm run send-webhook -- --order-id <ORDER_UUID>

# Send webhook with custom amount or status
npm run send-webhook -- --order-id <ORDER_UUID> --amount 6000 --status captured

# Automatically create a test order and pay for it
npm run send-webhook
```

---

## 8. How to Run Integration Tests Against Real PostgreSQL

All automated tests execute against a real PostgreSQL instance (`pickup_counter_test`). No database mocks or in-memory locks are used.

### Run All Test Suites (55 Tests Across API & Web)
```powershell
npm test
```

### Run Dedicated Concurrency & State Invariant Suite
```powershell
npm run test:concurrency
```

### Run End-to-End Customer Flow Script
```powershell
npm run verify:e2e
```

### Run Fresh-Start & Container Restart Verification
```powershell
npm run verify:fresh-start
```

### Run Tests Inside Docker Container
```powershell
docker compose --profile test run --rm test
```

---

## 9. Stock Reservation, Expiry, Payment Idempotency, and Pickup Concurrency

```mermaid
stateDiagram-v2
    [*] --> Pending: POST /orders (120s Hold)
    Pending --> Paid: Webhook Captured (Exact Amount, Hold Active)
    Pending --> Expired: Hold Expires (clock_timestamp >= expires_at)
    Pending --> NeedsReview: Webhook Amount Mismatch OR Late Capture
    Paid --> PickedUp: POST /orders/:id/pickup-claim (Atomic Stock Decrement)
    PickedUp --> [*]
    Expired --> [*]
    NeedsReview --> [*]
```

### 1. Inventory & Stock Reservation Formula
$$\text{available\_units} = \text{physical\_stock} - \text{active\_unpaid\_holds} - \text{paid\_uncollected\_holds}$$
- **Physical stock (`stock_units`)**: Items currently resting inside the locker counter.
- **Active unpaid holds (`pending`)**: Stock reserved for 120 seconds while the customer completes payment.
- **Paid uncollected holds (`paid`)**: Items paid for but not yet collected. Stock **remains reserved** so other shoppers cannot purchase items that have already been bought.
- **Decrement (`picked_up`)**: When locker door opens, physical `stock_units` is decremented and reservation is cleared in the same database transaction.

### 2. Deadlock Prevention & Row Locking
- Product IDs in multi-item orders are sorted lexicographically (`ORDER BY id ASC`) before executing `SELECT ... FOR UPDATE`.
- All concurrent transactions acquire product row locks in the exact same sequence, eliminating deadlocks.

### 3. Expiry Handled by Database Clock
- Available inventory queries calculate active holds in real time using `clock_timestamp()`.
- Expired holds are released dynamically the instant `expires_at <= clock_timestamp()` without waiting for background cron jobs.

### 4. Webhook Idempotency via Database Constraint
- `payment_events.event_id` is constrained `UNIQUE` in PostgreSQL.
- Sequential duplicate webhook deliveries return `200 OK` with `{ duplicate: true }`.
- Concurrent duplicate deliveries are serialized: one commits and the second catches unique violation `23505`, returning clean duplicate acknowledgments without double-transitioning the order.

### 5. Atomic Pickup Claims
- `POST /orders/:id/pickup-claim` executes `SELECT id, status FROM orders WHERE id = $1 FOR UPDATE`.
- If two lockers attempt to claim the same order concurrently:
  - Locker 1 acquires the row lock, validates `status === 'paid'`, decrements physical stock, sets `picked_up`, and commits.
  - Locker 2 unblocks, re-reads the committed row under PostgreSQL `Read Committed` isolation, sees `status === 'picked_up'`, aborts with `ROLLBACK`, and returns `HTTP 409 Conflict`.

---

## 10. Late-Payment Policy

### Late payment policy

If a capture arrives after an unpaid order's reservation has expired, the order is moved to `needs_review`. We do not automatically reclaim inventory or make the order eligible for pickup, because the units may already have been reserved by or sold to another customer. A human operator or automated reconciliation job can then inspect the order and decide whether to issue a refund or allocate replacement stock manually.

This prioritizes inventory correctness over automatic fulfillment. A future production implementation would integrate a payment-provider refund/reconciliation workflow and monitor unresolved captures.

---

## 11. Assumptions, Known Limitations, and Future Improvements

### Assumptions
1. **Locker Hardware Integration**: The physical locker counter is simulated via HTTP endpoints (`POST /orders/:id/pickup-claim`), representing locker controller door-release signals.
2. **Payment Provider Protocol**: The payment gateway delivers webhook notifications with an `X-Signature` header computed as the HMAC-SHA256 hex digest of the raw payload.
3. **Currency Domain**: All snack products and order calculations operate exclusively in Indian Paise (INR).

### Known Limitations
1. **Single-Region PostgreSQL**: High-concurrency row locking relies on PostgreSQL transactions on a single primary node.
2. **Manual Review Workflow**: The `needs_review` state requires human counter staff intervention and does not yet trigger automated refund webhook dispatches.
3. **Polling Client**: The React client uses an interval polling loop (`GET /orders/:id` every 1.5s) rather than a persistent Server-Sent Events (SSE) or WebSocket connection.

### Improvements With More Time
1. **WebSocket / SSE Live Streaming**: Replace client HTTP polling with Server-Sent Events or WebSockets to broadcast instant payment confirmations and locker unlock events.
2. **Automated Refund Integration**: Add payment gateway refund API clients to automatically trigger customer refunds when orders transition to `needs_review`.
3. **QR Code Locker Scanner**: Integrate camera-based QR code scanning in the React frontend so the customer can scan a QR code on the physical locker door to trigger the pickup claim.
4. **Distributed Redis Caching**: Implement Redis caching with distributed invalidation for read-heavy catalog queries under extreme visitor traffic.
