# Interview notes: Slotly

Talking points and likely questions. Everything here is true of the code in this repo; if you change the code, change the notes. Read the files named in each section before an interview so you can open them live: you'll be asked "show me".

---

## 30-second pitch

> Slotly is a multi-tenant booking app: a small business signs up, sets services and weekly hours, and shares a link; customers book without an account. I built it to get the hard parts right rather than the feature count: slot generation that's correct across timezones and DST, and booking that can't double-book even under concurrent requests. It's Next.js and TypeScript on Postgres, 100 tests, CI on every push.

## 2-minute walkthrough (what to click, what to say)

1. **`/b/demo-barber`**: pick a service, a day, a slot. "Times are in the shop's timezone; if you're elsewhere it tells you your local time."
2. **`lib/slots.ts`**: "Pure function: windows minus busy spans. No I/O, which is why it's easy to test, including DST."
3. **`lib/bookings.ts` → `createBooking`**: "Validate server-side for good errors, then insert. A Postgres exclusion constraint on the time range is the mutual exclusion, so the database refuses overlapping bookings no matter what the app does."
4. **`tests/slots.test.ts`**: scroll to the spring-forward and fall-back tests.
5. **Dashboard**: log in as the owner, cancel a booking (email appears in the server log).

---

## Concurrency and double-booking

**Q: How do you stop two people booking the same slot?**
Two steps. (1) Validate: I re-derive that day's free slots server-side and check the requested start is among them, so off-grid or closed-hours requests never get further and the customer gets a clear error. (2) Insert: the `bookings` table has `EXCLUDE USING gist (business_id WITH =, int8range(starts_at, ends_at) WITH &&) WHERE (status = 'confirmed')`. If two requests pass validation at the same moment, Postgres serialises the conflicting inserts and one fails with SQLSTATE `23P01`, which I map to `409 slot_taken`; the UI refreshes the slot list. So the app check is advisory and the constraint is authoritative. No locks, no `SELECT ... FOR UPDATE`, no cleanup code.

**Q: Why isn't a plain unique index on the start time enough?**
It only catches identical start times. A 60-minute booking at 10:00 and a 30-minute booking at 10:30 have different starts but overlap. A range exclusion constraint compares intervals, not points. The ranges are half-open, so 10:00-11:00 followed by 11:00-11:30 is allowed, cancelled bookings are exempt via the `WHERE` clause, and it's scoped per business. There's a test that hits the constraint with raw inserts, bypassing the application, for exactly these cases.

**Q: Why not `SELECT ... FOR UPDATE` or an advisory lock?**
Those make the app code serialise correctly, but only for code paths that remember to take the lock. The constraint protects every writer: a future admin tool, a migration script, a bug. Locks also need care around what exactly you lock (the business row serialises all of that tenant's bookings). With the constraint, concurrency control is declarative and I only need to handle one error code.

**Q: Your tests are single-process. How do you know it holds under concurrency?**
There's a test that fires 12 simultaneous `createBooking` calls for the same slot against real Postgres (PGlite) and asserts exactly one wins and the other 11 get `slot_taken`, plus one that races bookings of different lengths and asserts no two confirmed bookings overlap, and tests that insert directly to prove the constraint fires with the app bypassed. PGlite is a single-connection engine, so what that proves is the constraint's semantics, not multi-connection contention; I'd say that if asked. The next step would be N parallel requests at one slot against a deployment on a real Postgres, asserting exactly one 201.

**Q: What if the process crashes halfway through a booking?**
The booking is a single `INSERT`, which is atomic: it either exists or it doesn't, so there is no half-claimed state to clean up. Signup (business, owner, default hours) and replacing the weekly schedule run inside transactions, so a crash can't leave a business with no owner or a schedule with old and new windows mixed.

**Q: Why Postgres, and why Drizzle?**
It's a relational problem: tenants, services, bookings and one critical invariant that Postgres can enforce natively. Drizzle gives typed queries without hiding the SQL; the one thing it can't express, the exclusion constraint, lives in a small idempotent migration file. I tried SQLite first, then MongoDB, and moved for concrete reasons: SQLite on serverless means per-instance ephemeral disks, and MongoDB meant re-implementing exclusivity with lock documents. Postgres removed that code.

**Q: How do you test against Postgres without a database server?**
PGlite, which is real Postgres compiled to WASM. Each test gets a fresh in-memory instance with the real schema and constraint, so tests run anywhere with no Docker. Production uses the `pg` driver against Neon; both go through the same Drizzle type, so the code under test is the code that ships. The trade-off is that PGlite isn't a networked server, so I'd also run CI against a Postgres service container.

**Q: What about the user double-clicking submit?**
The button is disabled while submitting, and if two requests did arrive, the second gets 409. A client-supplied idempotency key would make the retry return the original booking instead; that's on the roadmap (it's the same mechanism payments would need).

---

## Timezones and DST

**Q: How do you handle timezones?**
Bookings are stored as UTC epoch milliseconds, so they're unambiguous. Opening hours are stored as *local wall-clock minutes* in the business's IANA timezone, because "open 09:00" means 09:00 on the shop's clock all year. To generate a day's slots I take the local date, build each window's start and end with Luxon from local fields, and step through in absolute time.

**Q: What's the DST trap?**
Computing "midnight + 9 hours" gives the wrong answer on a DST day, because adding hours adds *elapsed* time. Setting the wall-clock hour on the local date is right. On a spring-forward day the 02:00 hour doesn't exist, so a 01:00-05:00 window is three real hours and the picker skips 02:00. On a fall-back day 01:00 happens twice and both are valid slots. Both cases are tests (`America/New_York`, 8 March and 1 November 2026), as is a 23-hour and a 25-hour day length.

**Q: What about a customer in a different timezone?**
The page shows times in the business's zone, because that's when the appointment physically happens, and adds "that's 04:30 where you are" when the visitor's clock differs. The request carries a UTC instant, so there's no ambiguity on the wire.

**Q: Known weakness?**
On a fall-back day the two "01:00" buttons look identical. I'd show the UTC offset on those. Also: changing a business's timezone shifts when future slots occur in absolute time (the hours are wall-clock), though existing bookings don't move. The settings page says so.

**Q: Why Luxon?**
Reliable IANA zone handling and explicit DST resolution rules. The built-in `Date` can't construct "9:00 in Berlin" without hacks.

---

## Authentication and authorization

**Q: Walk me through auth.**
Signup/login validates input with Zod, hashes with bcrypt (cost 10), and issues an HS256 JWT in an `httpOnly`, `SameSite=Lax`, `Secure`-in-production cookie, 7-day expiry. The token holds only the user id.

**Q: Why not put the role in the token?**
Because then a removed or demoted user keeps their access until it expires. On every request I verify the token, then load the user and business from the database, so revocation is immediate. The cost is one indexed primary-key lookup per request, which is trivial on Postgres. If that mattered at scale I'd cache briefly or add a token version.

**Q: Why not localStorage?**
Any XSS can read localStorage. An `httpOnly` cookie isn't readable from JavaScript. The trade-off is CSRF, which I handle with `SameSite=Lax` plus an `Origin` check on state-changing requests.

**Q: How's RBAC done?**
`requireAuth(req, ['owner'])` in `lib/guard.ts` at the top of each handler. Owners can change anything; staff can list and cancel bookings. Pages redirect staff away from owner-only screens, but the API is the real enforcement; there is a test where a staff cookie gets 403 on creating services, replacing availability and listing staff.

**Q: Account enumeration?**
Login returns one generic message for both unknown email and wrong password, and always performs one bcrypt comparison (against a dummy hash if the user doesn't exist) so timing doesn't reveal which emails exist. Signup does reveal "email already registered", which is a common, deliberate usability trade-off; I'd note it.

**Q: What's missing?**
Email verification, password reset, login lockout beyond the per-IP rate limit, session revocation by device, 2FA.

---

## Multi-tenancy

**Q: How is tenant data isolated?**
Shared database, `business_id` on every tenant table. The tenant comes from the authenticated user, never from the request, and every query filters on it (`WHERE id = ? AND business_id = ?`). Cross-tenant access returns 404 rather than 403 so IDs can't be probed. `tests/api.test.ts` has a second business trying to cancel the first one's booking and to book the first one's service via its own slug.

**Q: What's the alternative and when would you use it?**
Schema-per-tenant or database-per-tenant for stronger isolation or per-tenant backup/residency. On Postgres I'd add row-level security as a second line of defence so a forgotten `WHERE` can't leak data.

---

## Validation, errors, abuse

**Q: Where does validation live?**
`lib/validators.ts`: every route parses with a Zod schema and gets the same error shape. Notable rules: IANA timezone check, integer minutes/cents, slugs, non-overlapping availability windows, UTC ISO instants only for bookings.

**Q: How do you rate limit?**
Sliding-window log per client IP: 10 booking attempts a minute, 60 slot lookups a minute, 10 auth attempts per 15 minutes. 429 with `Retry-After`.

**Q: What are the limits of that?**
It's in memory, so per process. On serverless or several instances the real ceiling is limit × instances, and the client IP comes from `x-forwarded-for`, which is only trustworthy behind a proxy that sets it. Production answer: Redis/Upstash with the same `check()` interface, plus bot protection (Turnstile) on the public booking form.

**Q: What stops someone filling the calendar with fake bookings?**
Rate limiting, the 60-day horizon, and email confirmation to the address provided. A real fix is email verification before a booking is confirmed, or a deposit. I'd say that out loud rather than pretend it's solved.

---

## Scaling

**Q: What breaks first?**
1. Connection count on serverless: each instance holds a small pool (default 5), so many concurrent instances can exhaust Postgres connections. Mitigation: Neon's pooled endpoint (PgBouncer), a low `PG_POOL_MAX`, and watching it first.
2. The in-memory rate limiter. Move to Redis.
3. Email sent inline in the request. Move to a queue/outbox so a slow provider doesn't slow bookings.
4. The slots endpoint recomputes per request. It's one indexed range query plus an in-memory loop, so it's cheap; if it weren't, cache per `(business, service, date)` and invalidate on booking.

**Q: Indexes?**
`bookings (business_id, starts_at)` for the day-range query, plus the GiST-backed exclusion constraint on confirmed bookings (which also serves overlap lookups); indexes starting with `business_id` on services, availability and users; unique on `users.email` and `businesses.slug`. All created idempotently in `lib/migrate.ts`.

**Q: Why not SQLite, which you started with?**
I did start with SQLite (zero setup, and `BEGIN IMMEDIATE` made the concurrency story simple), but on serverless each instance has its own ephemeral disk, so a hosted demo behaved inconsistently: a service id returned by one instance could 404 on another. A shared managed database fixes that. I tried MongoDB briefly and settled on Postgres (Neon) because the exclusion constraint makes the core guarantee a one-liner in the database.

---

## Testing

**Q: What's your testing strategy?**
The core logic is pure (`slots.ts`), so most coverage is fast unit tests with an injected clock. On top of that, DB-backed tests against in-memory Postgres via PGlite (each test gets its own database with the real schema and constraint) for the booking logic and its concurrency, and an API test that calls the real Next route handlers (no HTTP server) for the whole flow. Auth tests include tampered, expired, wrong-secret and `alg=none` tokens.

**Q: What's not tested?**
React components and a browser end-to-end flow. I drove the UI manually with a headless browser while building it, but there's no Playwright test in CI yet. Load testing across several app instances over HTTP is also missing.

**Q: A bug your tests caught or you hit while building?**
- A booking test I wrote for "in the past" used a timestamp that was actually an hour *in the future*; the code was right and my test data wrong. It made me add explicit tests for already-started slots and the exact minimum-notice boundary.
- A Tailwind precedence bug: I appended `w-32` to an input class that already had `w-full`, so the time pickers stretched across the screen. Fixed by replacing the class instead of appending it.
- TypeScript 7 (native compiler) broke `next build` because Next 15 loads `next.config.ts` through the JS compiler API. Pinned to 5.x.

---

## Roadmap items worth being able to discuss

**Payments and idempotent webhooks.** Stripe delivers webhooks at least once, possibly out of order and repeated. Handler design: verify the signature on the raw body; insert the event id into a `processed_events` table with a unique constraint *in the same transaction* as the state change; if the insert conflicts, return 200 and do nothing. Make state transitions monotonic (`pending → paid`; ignore a late duplicate). Hold the slot with a short-lived `pending` booking that a job expires if payment never completes, so the slot isn't blocked forever and isn't double-sold.

**Reminders.** A scheduled job selects bookings starting in ~24 h with `reminder_sent_at IS NULL`, sends, and sets the column in the same unit of work; the column is the idempotency guard so a retry can't double-send.

**Reschedule / self-cancel.** Signed, expiring token in the confirmation email; reschedule = cancel + book inside one transaction so the customer never ends up with zero or two slots.

**Per-staff calendars.** `resources` table; availability and the unique index scoped to `resource_id`.

---

## "Tell me about a design decision you'd defend"

Storing opening hours as wall-clock minutes and bookings as UTC instants. It looks inconsistent but each is the representation that stays correct: a booking is a moment in time and must never move; an opening hour is a rule about a local clock and *should* move with DST. Mixing them up is the classic source of "my 9 am slot became 10 am in March" bugs.

## "What would you do differently?"

Pick Postgres from day one for a domain this relational, and write the multi-instance load test before claiming concurrency safety beyond what the tests show.

## Questions to ask them

- How do you handle correctness-critical invariants like this: in the app, the database, or both?
- What does your testing look like for time-dependent code?
- How do you do schema migrations on a live multi-tenant database?
