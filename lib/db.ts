import { MongoClient, type Collection, type Db, type OptionalUnlessRequiredId } from "mongodb";
import { seedDemoIfMissing } from "./seed";
import type { AvailabilityRow, Booking, BookingLock, Business, Service, User } from "./schema";

/** A stored document: the app-level entity plus Mongo's `_id` (always equal to `id`). */
export type Doc<T extends { id: string }> = T & { _id: string };

export interface DB {
  client: MongoClient;
  db: Db;
  businesses: Collection<Doc<Business>>;
  users: Collection<Doc<User>>;
  services: Collection<Doc<Service>>;
  availability: Collection<Doc<AvailabilityRow>>;
  bookings: Collection<Doc<Booking>>;
  locks: Collection<BookingLock>;
}

/** Pass to find/findOne so `_id` never leaks into application objects. */
export const NO_ID = { projection: { _id: 0 } } as const;

/** Insert an entity, using its `id` as the document `_id`. */
export async function insertRow<T extends { id: string }>(col: Collection<Doc<T>>, row: T): Promise<void> {
  await col.insertOne({ _id: row.id, ...row } as unknown as OptionalUnlessRequiredId<Doc<T>>);
}

export async function insertRows<T extends { id: string }>(col: Collection<Doc<T>>, rows: T[]): Promise<void> {
  if (rows.length === 0) return;
  await col.insertMany(rows.map((r) => ({ _id: r.id, ...r }) as unknown as OptionalUnlessRequiredId<Doc<T>>));
}

/** True for MongoDB duplicate-key errors (code 11000), including ones wrapped in bulk-write errors. */
export function isDuplicateKeyError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: unknown; writeErrors?: unknown; cause?: unknown };
  if (err.code === 11000 || err.code === 11001) return true;
  if (Array.isArray(err.writeErrors) && err.writeErrors.some((w) => (w as { code?: unknown })?.code === 11000)) return true;
  return err.cause !== undefined && isDuplicateKeyError(err.cause);
}

/**
 * Connect and make sure the indexes exist (idempotent: safe to run on every cold start).
 * No transactions are used anywhere, so this works on a standalone mongod, a replica set
 * and every Atlas tier, including the free one.
 */
export async function createDb(uri: string, dbName: string): Promise<DB> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, ignoreUndefined: true });
  await client.connect();
  const db = client.db(dbName);

  const handle: DB = {
    client,
    db,
    businesses: db.collection("businesses"),
    users: db.collection("users"),
    services: db.collection("services"),
    availability: db.collection("availability"),
    bookings: db.collection("bookings"),
    locks: db.collection("booking_locks"),
  };

  await Promise.all([
    handle.businesses.createIndex({ slug: 1 }, { unique: true }),
    handle.users.createIndex({ email: 1 }, { unique: true }),
    handle.users.createIndex({ businessId: 1, createdAt: 1 }),
    handle.services.createIndex({ businessId: 1, createdAt: 1 }),
    handle.availability.createIndex({ businessId: 1, weekday: 1, startMin: 1 }),
    handle.bookings.createIndex({ businessId: 1, startsAt: 1 }),
    // Safety net behind the lock documents: two *confirmed* bookings can never share a start
    // time for one business. (Partial overlaps are what the per-minute locks are for.)
    handle.bookings.createIndex(
      { businessId: 1, startsAt: 1 },
      { unique: true, partialFilterExpression: { status: "confirmed" }, name: "bookings_active_start_uq" },
    ),
    handle.locks.createIndex({ bookingId: 1 }),
    handle.locks.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  return handle;
}

function config() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Create a free MongoDB Atlas cluster (or run mongod locally) and put the connection string in .env.local.",
    );
  }
  return { uri, dbName: process.env.MONGODB_DB ?? "slotly" };
}

// One connection per server process; survives dev-server hot reloads and is reused across
// warm serverless invocations. Caching the *promise* means concurrent first requests share it.
const g = globalThis as unknown as { __slotlyDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!g.__slotlyDb) {
    const { uri, dbName } = config();
    g.__slotlyDb = createDb(uri, dbName)
      .then(async (db) => {
        if (process.env.SLOTLY_DEMO_SEED === "1") await seedDemoIfMissing(db);
        return db;
      })
      .catch((e) => {
        g.__slotlyDb = undefined; // don't cache a failed connection forever
        throw e;
      });
  }
  return g.__slotlyDb;
}
