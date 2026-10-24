# Pickup Counter — Project Instructions

Build a self-service snack pickup counter assignment.

## Required stack
- TypeScript throughout
- Node.js with Express
- PostgreSQL
- React with Vite
- Docker Compose
- Automated integration tests against a real PostgreSQL database

## Engineering rules
- Store all money as integer paise. Never use floating-point arithmetic for money.
- PostgreSQL is the source of truth for stock and order state.
- Use database transactions and appropriate row locks to prevent overselling.
- Use a unique database constraint on payment event IDs.
- Verify webhook signatures using the exact raw request body and HMAC-SHA256.
- Use timing-safe signature comparison.
- Make webhook processing idempotent.
- Make pickup claims atomic so exactly one simultaneous claim succeeds.
- Never trust client-supplied prices, totals, or countdown timestamps.
- Validate all API inputs and return clear HTTP errors.
- Keep business logic separate from HTTP routes.
- Use migrations and deterministic seed data.
- Never use mocked database operations for the required concurrency tests.
- Never hardcode secrets in source control.
- Keep TypeScript strict and write readable, maintainable code.

## Workflow
- Work in small stages.
- Explain the design before implementing each difficult feature.
- Show which files will be created or modified.
- Implement one feature at a time.
- Run relevant tests after every stage.
- Report exact commands and actual results.
- Never claim a test passes unless it was actually executed successfully.
- Do not replace real database concurrency with in-memory locks.
- Do not silently skip failed tests or unfinished requirements.
