# AI Usage Notes

## Tools used
- **Antigravity CLI (Gemini 2.5 Pro)**: Used for complete TypeScript full-stack implementation, database migrations, raw-body HMAC-SHA256 middleware, pessimistic concurrency locking (`SELECT ... FOR UPDATE`), Vitest integration test suite generation, and the React customer UI with `performance.now()` monotonic timing.
- **Cursor**: Used for initial monorepo scaffolding, directory structuring, and local IDE editing.
- **ChatGPT**: Used to plan the architecture, design the three-part inventory formula (`available = physical - unpaid_holds - paid_holds`), develop implementation prompts, and review PostgreSQL ACID concurrency requirements.

---

## A prompt that worked well

> "Implement GET /products and POST /orders using the existing PostgreSQL schema.
> The hard requirement is concurrency safety. Ten concurrent requests must not reserve the same units twice. Use database transactions and SELECT FOR UPDATE on product rows in deterministic order. Compute available inventory from physical stock, active unpaid holds, and paid but uncollected orders.
> For POST /orders:
> - Validate product IDs and positive integer quantities.
> - Consolidate duplicate product IDs.
> - Check all items before inserting anything.
> - Read prices from PostgreSQL, never from the request body.
> - Store integer paise and snapshot unit prices.
> - Create a 120-second hold using the database clock.
> - Return expiresInSeconds measured immediately before the response is sent.
> - Roll back all changes if any requested product lacks stock.
> Implement expiry transitions without relying solely on in-memory timers. Ensure expiry and payment cannot overwrite each other's valid terminal decisions.
> Add tests for basic catalog behavior, insufficient stock, duplicate product lines, and order totals. Explain the locking strategy and any deadlock considerations. Do not claim concurrency safety without a real PostgreSQL test."

### Why it worked well
It provided exact, unambiguous constraints on the concurrency model (pessimistic row locking, deterministic lexicographical order to prevent deadlocks, atomic rollback rules, integer paise arithmetic, and real PostgreSQL testing rather than mocks). It forced the AI to solve the concurrency challenge at the database level rather than trying to use naive in-memory JavaScript mutexes.

---

## An AI mistake I identified

### 1. The Mistake: Destructive Seed Upsert on Server Restart
In `apps/api/src/db/seed.ts`, the AI initially wrote the seed routine with an upsert query:
```sql
INSERT INTO products (id, name, price_paise, stock_units, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price_paise = EXCLUDED.price_paise,
  stock_units = EXCLUDED.stock_units,
  updated_at = NOW();
```

### How I noticed it
During a code review of container startup scripts for Step 10.3 ("Make sure migrations are repeatable and that restarting the API does not erase data or lose order-expiry correctness"). Because `wait-and-start.ts` runs on container boot to ensure the database is seeded, this `ON CONFLICT DO UPDATE` statement would reset `stock_units` back to default seed values (e.g. Cookies back to 8) on every container restart, effectively erasing all customer purchases and inventory decrements!

### How I corrected it
I changed the query to:
```sql
INSERT INTO products (id, name, price_paise, stock_units, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (id) DO NOTHING;
```
This ensures deterministic seeding on an empty database while guaranteeing that existing inventory levels, order histories, and decremented stock are never overwritten when the API or container restarts.

### Verification
I wrote and executed `apps/api/scripts/verify-fresh-start.ts` (`npm run verify:fresh-start`), which:
1. Created an order for 2 Cookies and captured payment.
2. Claimed pickup, decrementing physical stock from 8 to 6.
3. Simulated an API server restart by executing the startup sequence (`runMigrations()` and `seedDatabase()`).
4. Verified that Cookies physical stock remained strictly at 6 in PostgreSQL and was not reset to 8.

---

## Additional AI mistake identified during webhook concurrency

### The Mistake: Unhandled Database Unique Constraint Race on Concurrent Webhooks
Initially, `processPaymentWebhook` relied solely on an application-level check:
```sql
SELECT pe.id FROM payment_events pe WHERE pe.event_id = $1
```
When testing simultaneous duplicate webhook arrivals (`Promise.all` with identical `eventId`), both transactions performed the select simultaneously before either committed. Both saw 0 records, and both issued `INSERT INTO payment_events`. The second request threw an unhandled PostgreSQL unique constraint error (`code: 23505`) on `payment_events_event_id_key` and crashed with an HTTP 500 error instead of returning an idempotent HTTP 200 duplicate response.

### How I corrected it
I added a database exception handler in the `catch` block of `processPaymentWebhook`:
```typescript
if (error?.code === "23505" && error?.constraint?.includes("payment_events_event_id")) {
  const orderCheck = await pool.query("SELECT status FROM orders WHERE id = $1", [event.orderId]);
  return {
    received: true,
    duplicate: true,
    eventId: event.eventId,
    orderId: event.orderId,
    orderStatus: orderCheck.rows[0]?.status ?? "paid",
    message: "Concurrent duplicate event resolved idempotently",
  };
}
```

### Verification
Verified by running `npm run test:concurrency`, where the concurrent duplicate webhook delivery test sends two simultaneous requests with the same `eventId` and asserts that both receive HTTP 200 and only one row is created in `payment_events`.

---

## Verification

### Commands Executed & Actual Results
- **Full Test Suite**: `npm test`
  - **Result**: 8 test suites passed, 55 tests passed (7 suites / 53 tests in `@pickup-counter/api`, 1 suite / 2 tests in `@pickup-counter/web`).
- **Dedicated Concurrency Suite**: `npm run test:concurrency`
  - **Result**: 10 tests passed in 1.82s against real PostgreSQL:
    1. 10 concurrent customers for last 2 units (2 succeed, 8 fail with HTTP 409).
    2. Sequential duplicate webhook delivery (idempotent duplicate acknowledgment).
    3. Concurrent duplicate webhook delivery (unique constraint collision handled cleanly).
    4. Two simultaneous pickup claims (serialized by row lock; exactly 1 succeeds, 1 receives 409).
    5. Partial-reservation rollback on multi-item orders.
    6. Real-time hold expiry releasing inventory without manual cron jobs.
    7. Payment amount mismatch flagging `needs_review`.
    8. Webhook signature security rejecting missing, invalid secret, or tampered payloads (HTTP 401).
- **End-to-End User Flow**: `npm run verify:e2e`
  - **Result**: Complete customer journey verified from catalog browsing to cart creation, hold creation, payment simulation, locker pickup claim, and inventory decrement.
- **Fresh-Start & Restart Test**: `npm run verify:fresh-start`
  - **Result**: Verified idempotent migrations and non-destructive seeding on server restart.
- **TypeScript Typecheck**: `npm run typecheck`
  - **Result**: 0 errors across `@pickup-counter/api` and `@pickup-counter/web`.
- **Production Build**: `npm run build`
  - **Result**: API TypeScript build and Vite React production bundle compiled cleanly in under 1 second.

### Known Unfinished Items
None for the core assignment requirements. Future production enhancements identified:
1. Automated refund API integration with payment provider when orders transition to `needs_review`.
2. Server-Sent Events (SSE) or WebSocket push notifications to replace client HTTP polling.
3. Camera-based QR code locker scanner for physical counter collection.

I did not treat AI-generated code as verified until I reviewed it and ran the relevant checks against real PostgreSQL.
