/**
 * Zero-setup schema bootstrap. Idempotent, so it is safe to run on every start.
 * Kept as plain SQL so `git clone && npm run dev` works without a migration step.
 * (Moving to Postgres: generate real migrations with drizzle-kit from lib/schema.ts.)
 */
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_business_idx ON users (business_id);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS services_business_idx ON services (business_id);

CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS availability_business_idx ON availability (business_id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at INTEGER NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_start_uq
  ON bookings (business_id, starts_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS bookings_business_start_idx ON bookings (business_id, starts_at);
`;
