# Slotly

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

Multi-tenant appointment booking for small businesses (barbers, clinics, tutors). A business signs up, lists its services and weekly hours, and shares one link; customers pick a service, a day and a time, and book without an account.

The interesting parts are the ones that are easy to get subtly wrong: **timezone/DST-correct slot generation** and **double-booking protection**. Both are covered by tests (103 of them, including DST spring-forward and fall-back days and a parallel-request race).

<p>
  <img src="docs/screenshots/booking-page.png" alt="Public booking page" width="48%">
  <img src="docs/screenshots/dashboard.png" alt="Owner dashboard" width="48%">
</p>

## Features

- **Owner accounts**: signup/login with bcrypt-hashed passwords and a JWT in an `httpOnly` cookie; roles `owner` and `staff` (staff can see and cancel bookings, nothing else).
- **Business setup**: profile (slug, timezone, currency), services (name, duration, price), weekly opening hours with multiple windows per day.
- **Public booking page** at `/b/[slug]`: service → day → time → details. No customer account.
- **Slot engine** (`lib/slots.ts`): opening hours minus existing bookings, timezone-correct, stored in UTC.
- **No double bookings**: the slot is re-validated on the server, then claimed atomically with per-minute lock documents; a partial unique index is the safety net.
- **Owner dashboard**: list, filter and cancel bookings; cancellations email the customer.
- **Safety rails**: Zod validation on every route, in-memory rate limiting, same-origin check on state-changing requests.
- **Email**: prints to the console by default; sends through Resend (`RESEND_API_KEY`) or any SMTP server such as Gmail (`SMTP_USER` + `SMTP_PASS`) when configured.

## Quick start

Requires **Node 22.12 or newer** (see `.nvmrc`; run `nvm use`) and a **MongoDB** database: either a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (M0) or a local `mongod`.

```bash
npm install
cp .env.example .env.local      # then set MONGODB_URI (see below)
npm run seed                    # demo business + owner login
npm run dev                     # http://localhost:3000
```

`MONGODB_URI` is your connection string, e.g. `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/` from Atlas (Connect → Drivers; allow your IP under Network Access), or `mongodb://127.0.0.1:27017` for a local server. The database name defaults to `slotly` (`MONGODB_DB` to change it). Collections and indexes are created automatically on first connect.

| What | Where |
| --- | --- |
| Public booking page | http://localhost:3000/b/demo-barber |
| Owner dashboard | http://localhost:3000/login → `demo@slotly.dev` / `demo1234` |

Booking emails appear in the terminal running `npm run dev`.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve the build |
| `npm test` | Vitest suite (unit + integration through the real route handlers, against an in-memory MongoDB) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Create the demo business (idempotent) |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    C[Customer<br/>/b/slug]
    O[Owner / staff<br/>/dashboard]
  end

  subgraph Next.js 15 app
    P[Pages<br/>React Server + Client Components]
    R[Route handlers<br/>/api/*]
    G[guard.ts<br/>auth, RBAC, origin check]
    V[validators.ts<br/>Zod]
    RL[ratelimit.ts]
    B[bookings.ts<br/>validate, then atomic claim]
    S[slots.ts<br/>pure slot engine]
    M[mailer.ts<br/>Console, Resend or SMTP]
  end

  DB[(MongoDB<br/>official driver)]

  C --> P
  O --> P
  C -->|public API| R
  O -->|cookie session| R
  R --> RL --> V --> G
  G --> B
  B --> S
  B --> DB
  R --> M
```

**Booking a slot, step by step**

1. Browser asks `GET /api/public/:slug/slots?serviceId&date`. The server loads the weekly windows and that day's confirmed bookings and runs them through `generateSlots`.
2. Customer picks a slot and posts `POST /api/public/:slug/bookings` with the slot's UTC start time.
3. The server **recomputes** the free slots for that day and checks the requested start is still among them. The client's view of "free" is never trusted.
4. It then **claims** the appointment atomically: one lock document per minute, with a deterministic `_id`. MongoDB enforces `_id` uniqueness atomically, so two overlapping requests cannot both succeed. The loser gets 409.
5. The booking document is written; a partial unique index `(businessId, startsAt) WHERE status = 'confirmed'` backs this up at the database level.
6. Confirmation emails go out afterwards; a mail failure never fails the booking.

### Project structure

```
app/
  api/               route handlers (auth, business, services, availability, bookings, staff, public/*)
  b/[slug]/          public booking page
  dashboard/         owner/staff area
  login, signup, page.tsx (landing)
components/          BookingWidget, AuthForm, dashboard/*, ui.tsx (tiny design system)
lib/
  slots.ts           pure slot generation (the core)
  bookings.ts        availability queries + validate-then-claim booking
  schema.ts, db.ts   document types; connection, indexes and small helpers (MongoDB driver)
  auth.ts, guard.ts  passwords + JWT, request authentication and RBAC
  validators.ts      every input schema
  ratelimit.ts, mailer.ts, api.ts, serialize.ts, seed.ts, format.ts
scripts/seed.ts
tests/               slots, bookings, api (end-to-end), auth, validators, ratelimit
.github/workflows/ci.yml
```

## Design decisions

**Time model.** Instants (bookings) are integer epoch milliseconds, i.e. UTC. Opening hours are *wall-clock minutes in the business timezone*. "Open 09:00" is a statement about the shop's clock, so on a DST-change day the window really is an hour shorter or longer in absolute time. Slot generation therefore builds each window's start and end from local wall-clock fields via Luxon (never `startOfDay + N minutes`, which drifts across DST), then steps in absolute time. The tests pin down spring-forward (the 02:00 hour doesn't exist), fall-back (01:00 happens twice and both are bookable), half-hour offsets (Kolkata) and a local day that starts on the previous UTC day (Auckland).

**Double-booking.** MongoDB has no exclusion constraints, and I deliberately avoid multi-document transactions so the app runs on a standalone `mongod` and every Atlas tier. Instead, exclusivity comes from **lock documents**: booking 10:00-11:00 inserts 60 documents with `_id` = `businessId:minuteIndex`. `_id` uniqueness is enforced atomically by the server, so for any two overlapping bookings at least one insert fails; that handles partial overlaps (10:30 vs an existing 10:00-11:00) that a unique index on the start time cannot see. The sequence is validate (re-derive the slot grid server-side), claim (insert all locks, all-or-nothing by undoing partial inserts), then write the booking. Failure handling is explicit: if the process dies after claiming but before writing, the orphaned locks are reclaimed after a short grace period; if it dies between marking a booking cancelled and freeing its locks, the leftovers are reclaimed too (cancel marks first, then frees, so a booking can never be confirmed without locks). A TTL index garbage-collects old locks. The partial unique index on confirmed bookings stays as the safety net for any code path that skips the claim. Tests cover exact, partial and adjacent overlaps, 12 simultaneous requests for one slot (exactly one wins), racing bookings of different lengths, stale-lock recovery, cancel-then-rebook, two separate connections, and the raw index with the lock layer bypassed.

**Server-side re-validation.** The booking endpoint accepts a start instant, not "slot #3". It regenerates the day's slots and checks membership, so off-grid times, closed days, past times, the 30-minute minimum notice and the 60-day horizon are all enforced on the server regardless of what the UI offered.

**Auth.** bcryptjs (cost 10) for passwords; HS256 JWT via `jose` in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production). The token carries only the user id. Role and tenant are re-read from the database on every request, so removing a staff member or changing a role takes effect immediately instead of living on in a 7-day token. Login runs one bcrypt comparison even for unknown emails and returns one generic error, to avoid user enumeration by timing or message. State-changing authenticated requests also check that `Origin` matches the host (CSRF defence in depth on top of SameSite).

**Multi-tenancy.** Shared schema, `business_id` on every tenant table. Tenant scoping happens in the query filter (`{ _id, businessId }`), taken from the authenticated user, never from the request. Cross-tenant access answers 404, and there are tests for it.

**Validation.** Every route parses its body or query with a Zod schema; errors come back as `{ error: { code, message, details[] } }` with 422. Service durations, prices, slugs, timezones (checked against the IANA database) and overlapping availability windows are all validated.

**Rate limiting.** Sliding-window log in memory: 10 booking attempts/min/IP, 60 slot lookups/min/IP, 10 auth attempts/15 min/IP. Returns 429 with `Retry-After`.

**Mailer abstraction.** A one-method interface with three implementations: `ConsoleMailer` (default, zero setup), `ResendMailer` (plain `fetch`, no SDK) and `SmtpMailer` (nodemailer, e.g. Gmail). `getMailer()` picks one from the environment. Callers never know which, and a delivery failure is logged but never fails a booking.

**Data store.** MongoDB through the official driver, with typed collections (`lib/schema.ts`) and indexes declared in code (`lib/db.ts`), created idempotently on connect. Each document's `_id` is its `id`, and reads project `_id` away, so application code only sees `id`. The connection is cached on `globalThis`, so dev hot reloads and warm serverless invocations reuse it, and, unlike a file on a serverless disk, every instance shares one database.

## Trade-offs (what I knew I was giving up)

- **A document store for relational data.** Bookings, services and tenants are relational and this schema would be a natural fit for Postgres. MongoDB works, but the integrity guarantees a relational database gives for free (foreign keys, exclusion constraints, multi-row transactions) are re-implemented in application code here: lock documents for exclusivity, hand-written compensation for multi-document writes. That code is tested but it is more to maintain than one `EXCLUDE` constraint.
- **No multi-document transactions.** Signup (business, owner, default hours) and "replace weekly schedule" are sequences of writes with manual cleanup on failure, not atomic units. A crash at the wrong moment can leave a half-created business with no owner, or a schedule with old and new windows briefly side by side. Acceptable for this app; on a replica set I'd use `withTransaction`.
- **Lock documents.** One per booked minute, so a 60-minute appointment writes 60 small documents (garbage-collected by a TTL index). Simple and correct, but chattier than a range constraint.
- **One resource per business.** A business has one calendar: no per-staff or per-room columns. Multi-resource booking needs a `resources` table and the unique index becomes `(resource_id, starts_at)`.
- **In-memory rate limiter.** Per-process, so the effective limit multiplies with the number of instances. Swap the `Map` for Redis/Upstash behind the same `check()` interface.
- **Ambiguous local times.** On a fall-back day, "01:00" appears twice in the picker (they are different instants and both bookable). A production UI would add the UTC offset to disambiguate.
- **No customer self-service cancel/reschedule, no payments, no calendar sync.** All on the roadmap below.
- **Schema is enforced in code, not by the database.** The TypeScript types and Zod validators are the schema; MongoDB itself would accept malformed documents written by another tool. Atlas JSON Schema validation could be added.
- **`npm audit` reports PostCSS advisories** through the copy bundled in Next 15. They concern processing untrusted CSS at build time, which this app never does, and the fix is a major upgrade to Next 16. Worth doing as a follow-up.
- **TypeScript is pinned to 5.x.** TypeScript 7's native compiler doesn't expose the JS API that Next 15 uses to load `next.config.ts`, so `next build` fails on it today.

## API

All responses are JSON. Errors: `{ "error": { "code", "message", "details?" } }`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | public | Create business + owner, set session cookie |
| POST | `/api/auth/login` | public | Sign in |
| POST | `/api/auth/logout` | any | Clear cookie |
| GET | `/api/auth/me` | any | Current user and business |
| GET / PATCH | `/api/business` | any / owner | Read / update profile |
| GET / POST | `/api/services` | any / owner | List / create |
| PATCH | `/api/services/:id` | owner | Edit or archive (`active: false`) |
| GET / PUT | `/api/availability` | any / owner | Read / atomically replace weekly windows |
| GET | `/api/bookings?scope=upcoming\|past\|all` | any | List bookings |
| POST | `/api/bookings/:id/cancel` | owner, staff | Cancel (idempotent), email customer |
| GET / POST | `/api/staff` | owner | List team / create staff login |
| DELETE | `/api/staff/:id` | owner | Remove staff |
| GET | `/api/public/:slug` | public | Business + active services |
| GET | `/api/public/:slug/slots?serviceId&date` | public, rate-limited | Free slots for a local date |
| POST | `/api/public/:slug/bookings` | public, rate-limited | Create a booking (409 `slot_taken`, 422 `slot_unavailable`) |

## Testing

```bash
npm test
```

Tests need a real MongoDB. By default `mongodb-memory-server` starts a throwaway in-memory `mongod` (it downloads the binary on the first run and caches it, so the first run is slower and needs network access). To use a server you already have, set `MONGODB_TEST_URI`; every test uses its own uniquely named database and drops it afterwards, but never point it at production data.

| Suite | What it proves |
| --- | --- |
| `slots.test.ts` | Slot grid, split shifts, partial/adjacent overlap, clock and minimum notice, timezones, DST spring-forward and fall-back, 23/25-hour days |
| `bookings.test.ts` | Double-booking (exact, partial, adjacent), 12 simultaneous requests for one slot, racing bookings of different lengths, stale-lock recovery, cancel-then-rebook, two DB connections, unique index with the lock layer bypassed, invalid slots, tenant isolation |
| `api.test.ts` | Full flow through the real route handlers: signup → configure → book → 409 on conflict → RBAC → cross-tenant 404 → CSRF origin check → 429 |
| `auth.test.ts` | bcrypt, JWT round-trip, wrong secret, tampering, expiry, `alg=none`, missing secret in production |
| `validators.test.ts`, `ratelimit.test.ts` | Input rules; limiter window and per-key behaviour |

CI (`.github/workflows/ci.yml`) runs typecheck, tests and a production build on every push and pull request.

## Sending real email (Gmail)

By default booking emails only appear in the terminal. To deliver them for real with a Gmail account:

1. Turn on 2-Step Verification for the Google account, then create an **App Password** at https://myaccount.google.com/apppasswords.
2. Create `.env.local` in the project root:
   ```
   SMTP_USER=you@gmail.com
   SMTP_PASS=your16characterapppassword
   ```
3. Restart `npm run dev` (env files are read on startup).

Gmail works for demos (any recipient, no domain needed, roughly 500 messages a day). For production use a transactional provider such as Resend, Postmark or SES with a verified domain.

## Deploying

Environment variables (see `.env.example`):

| Variable | Notes |
| --- | --- |
| `JWT_SECRET` | **Required in production.** `openssl rand -base64 32` |
| `MONGODB_URI` | **Required.** MongoDB connection string (Atlas `mongodb+srv://...` or `mongodb://127.0.0.1:27017`) |
| `MONGODB_DB` | Database name. Default `slotly` |
| `SLOTLY_DEMO_SEED=1` | Make sure the demo business exists on startup (idempotent; deterministic ids) |
| `RESEND_API_KEY`, `MAIL_FROM` | Send email through Resend (needs a verified domain to reach arbitrary recipients) |
| `SMTP_USER`, `SMTP_PASS` | Send email through SMTP; Gmail by default. Use a Gmail **App Password**, not your login password |
| `SMTP_HOST`, `SMTP_PORT` | Optional. Default `smtp.gmail.com` / `465` |

| `INSECURE_COOKIES=1` | Only for running a production build over plain `http://localhost` |

If none of the email variables are set, emails are printed to the server console.

**Vercel.** Create a free Atlas cluster (M0) and a database user, and under Network Access allow `0.0.0.0/0` (Vercel's outbound IPs aren't fixed). Import the repo into Vercel and set `MONGODB_URI`, `JWT_SECRET` and (optionally) `SLOTLY_DEMO_SEED=1`, then deploy. Because the data lives in Atlas rather than on the function's disk, every serverless instance sees the same bookings, and data survives redeploys and cold starts.

## What I'd do next

1. **Postgres (Neon), if the relational guarantees matter more than the document model.** Replace the lock documents with `EXCLUDE USING gist (business_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'confirmed')`, so overlaps are impossible at the database level, and make signup and schedule replacement real transactions.
2. **Customer self-service**: a signed cancel/reschedule link in the confirmation email.
3. **Payments (Stripe)** with deposits. Webhook handlers must be idempotent: store the event id with a unique constraint, process inside a transaction, and make "mark booking paid" a no-op if already applied. Hold a slot with a short-lived `pending` status that expires if payment doesn't complete.
4. **Reminders** via a scheduled job (email/SMS 24 h before).
5. **Per-staff calendars** and buffers between appointments; ICS attachments and Google Calendar sync.
6. **Shared rate limiting** (Upstash Redis) and a login lockout/backoff.
7. **Playwright end-to-end test** of the booking flow, plus ESLint in CI.
8. **Observability**: structured logs, error tracking, a `/api/health` check.

## License

MIT, see [LICENSE](LICENSE).
