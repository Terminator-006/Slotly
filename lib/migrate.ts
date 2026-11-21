/**
 * Zero-setup schema bootstrap. Idempotent, so it is safe to run on every start
 * (createDb runs it under an advisory lock so concurrent cold starts don't race).
 * Kept as plain SQL so `git clone && npm run dev` works without a migration step.
 * For a team or a long-lived production database, generate real migrations with drizzle-kit
 * from lib/schema.ts and keep the EXCLUDE constraint below as a hand-written migration.
 */
export const MIGRATION_SQL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS businesses (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  timezone    text NOT NULL,
  currency    text NOT NULL DEFAULT 'USD',
  created_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY,
  business_id    text NOT NULL REFERENCES businesses(id),
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at     bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS users_business_idx ON users (business_id);

CREATE TABLE IF NOT EXISTS services (
  id           text PRIMARY KEY,
  business_id  text NOT NULL REFERENCES businesses(id),
  name         text NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min > 0),
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  active       boolean NOT NULL DEFAULT true,
  created_at   bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS services_business_idx ON services (business_id);

CREATE TABLE IF NOT EXISTS availability (
  id           text PRIMARY KEY,
  business_id  text NOT NULL REFERENCES businesses(id),
  weekday      integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min    integer NOT NULL CHECK (start_min >= 0),
  end_min      integer NOT NULL CHECK (end_min <= 1440),
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS availability_business_idx ON availability (business_id);

CREATE TABLE IF NOT EXISTS bookings (
  id              text PRIMARY KEY,
  business_id     text NOT NULL REFERENCES businesses(id),
  service_id      text NOT NULL REFERENCES services(id),
  customer_name   text NOT NULL,
  customer_email  text NOT NULL,
  starts_at       bigint NOT NULL,
  ends_at         bigint NOT NULL,
  status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at      bigint NOT NULL,
  CHECK (ends_at > starts_at),
  -- The guarantee: two CONFIRMED bookings of one business can never overlap in time.
  -- int8range(starts_at, ends_at) is half-open [start, end), so back-to-back bookings are fine,
  -- and cancelled rows are exempt via the WHERE clause. Postgres enforces this atomically,
  -- even for concurrent transactions, which no application-level check can.
  CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (business_id WITH =, int8range(starts_at, ends_at) WITH &&)
    WHERE (status = 'confirmed')
);
CREATE INDEX IF NOT EXISTS bookings_business_start_idx ON bookings (business_id, starts_at);
`;
