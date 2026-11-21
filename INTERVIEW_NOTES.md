# Interview notes: Slotly

Talking points and likely questions. Everything here is true of the code in this repo; if you change the code, change the notes. Read the files named in each section before an interview so you can open them live: you'll be asked "show me".

---

## 30-second pitch

> Slotly is a multi-tenant booking app: a small business signs up, sets services and weekly hours, and shares a link; customers book without an account. I built it to get the hard parts right rather than the feature count: slot generation that's correct across timezones and DST, and booking that can't double-book even under concurrent requests. It's Next.js and TypeScript on MongoDB, 103 tests, CI on every push.

## 2-minute walkthrough (what to click, what to say)

1. **`/b/demo-barber`**: pick a service, a day, a slot. "Times are in the shop's timezone; if you're elsewhere it tells you your local time."
2. **`lib/slots.ts`**: "Pure function: windows minus busy spans. No I/O, which is why it's easy to test, including DST."
3. **`lib/bookings.ts` → `createBooking`**: "Validate server-side, then atomically claim one lock document per minute. `_id` uniqueness is the mutual exclusion. Unique index as the safety net."
4. **`tests/slots.test.ts`**: scroll to the spring-forward and fall-back tests.
5. **Dashboard**: log in as the owner, cancel a booking (email appears in the server log).

---

## Concurrency and double-booking

**Q: How do you stop two people booking the same slot?**
Three steps. (1) Validate: I re-derive that day's free slots server-side and check the requested start is among them, so off-grid or closed-hours requests never get further. (2) Claim: booking 10:00-11:00 inserts one lock document per minute, with `_id = businessId:minuteIndex`. MongoDB enforces `_id` uniqueness atomically, so two overlapping requests can't both get every minute; the loser's partial inserts are undone and it gets `409 slot_taken`, and the UI refreshes the slot list. (3) Write the booking document. A partial unique index on `(businessId, startsAt) WHERE status = 'confirmed'` is a safety net behind that. I avoided multi-document transactions on purpose, so it runs on a standalone `mongod` and the free Atlas tier.

**Q: Why isn't the unique index enough?**
It only catches identical start times. A 60-minute booking at 10:00 and a 30-minute booking at 10:30 have different starts but overlap. That's what the per-minute locks are for: the two bookings share a minute, and `_id` uniqueness makes that conflict atomic. There's a test for exactly that case.

**Q: What would you do on Postgres?**
I'd use a real constraint instead of lock documents: `SELECT ... FOR UPDATE` on the business row (or `pg_advisory_xact_lock`) inside a transaction, and better still push the invariant into the database with an exclusion constraint: `EXCLUDE USING gist (business_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'confirmed')`. Then overlap is impossible at the data layer, not just unlikely at the app layer.

**Q: Your tests are single-process. How do you know the lock works?**
There's a test that fires 12 simultaneous `createBooking` calls for the same slot against a real MongoDB and asserts exactly one wins and the other 11 get `slot_taken`, plus one that races bookings of different lengths and asserts no two confirmed bookings overlap. Another opens two separate connections, like two server instances, and a third bypasses the lock layer to prove the unique index fires. What I haven't done is load-test across several app processes over HTTP; that would be the next step (N parallel `curl`s at one slot against a multi-instance deployment, asserting exactly one 201).

**Q: What if the process crashes halfway through a booking?**
Two crash windows, both handled. If it dies after claiming the locks but before writing the booking, the orphan locks block that slot; a later claim sees locks whose booking doesn't exist and are older than a 15-second grace period, deletes them and retries. If it dies during cancel, I mark the booking cancelled first and free the locks second, so the worst case is leftover locks on a cancelled booking, which the same reclaim logic removes. The reverse order could leave a confirmed booking with no locks, which is the dangerous one. A TTL index also garbage-collects old locks.

**Q: Why MongoDB for this?**
Honestly it's a relational problem and Postgres would give me an exclusion constraint and transactions for free. I chose Mongo for a managed free tier that every serverless instance can share, and because it let me show I can build the exclusion guarantee myself on a store that lacks it. The cost is application code I have to maintain and test (the locks and the manual cleanup in signup), and I'd say so before being asked.

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
Because then a removed or demoted user keeps their access until it expires. On every request I verify the token, then load the user and business from the database, so revocation is immediate. The cost is one indexed primary-key lookup per request, which is trivial on MongoDB too. If that mattered at scale I'd cache briefly or add a token version.

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
Schema-per-tenant or database-per-tenant for stronger isolation or per-tenant backup/residency. With Postgres I'd consider row-level security as a second line of defence so a forgotten `WHERE` can't leak data.

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
1. Lock-document volume (one per booked minute; TTL keeps it bounded) and the lack of multi-document transactions in signup. Moving to Postgres with an exclusion constraint removes both.
2. The in-memory rate limiter. Move to Redis.
3. Email sent inline in the request. Move to a queue/outbox so a slow provider doesn't slow bookings.
4. The slots endpoint recomputes per request. It's one indexed range query plus an in-memory loop, so it's cheap; if it weren't, cache per `(business, service, date)` and invalidate on booking.

**Q: Indexes?**
`bookings (businessId, startsAt)` for the day-range query, plus the partial unique index on confirmed bookings; compound indexes starting with `businessId` on services, availability and users; unique on `users.email` and `businesses.slug`; a TTL index on lock documents. All created idempotently in `lib/db.ts`.

**Q: Why not SQLite, which you started with?**
I did start with SQLite (zero setup, and `BEGIN IMMEDIATE` made the concurrency story simple), but on serverless each instance has its own ephemeral disk, so a hosted demo behaved inconsistently: a service id returned by one instance could 404 on another. A shared managed database fixes that, which is why it moved to MongoDB Atlas.

---

## Testing

**Q: What's your testing strategy?**
The core logic is pure (`slots.ts`), so most coverage is fast unit tests with an injected clock. On top of that, DB-backed tests against a throwaway in-memory MongoDB (each test gets its own database) for the booking logic and its concurrency, and an API test that calls the real Next route handlers (no HTTP server) for the whole flow. Auth tests include tampered, expired, wrong-secret and `alg=none` tokens.

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
