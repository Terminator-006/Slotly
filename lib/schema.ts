import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Time model: every instant is stored as integer epoch milliseconds (UTC).
 * Availability windows are the exception: they are *local wall-clock* minutes
 * in the business timezone ("09:00" means 09:00 wherever the shop is, DST included).
 *
 * If you change this file, mirror the change in lib/migrate.ts.
 */

export const businesses = sqliteTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull(), // IANA, e.g. "Europe/Berlin"
  currency: text("currency").notNull().default("USD"),
  createdAt: integer("created_at").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner", "staff"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("users_business_idx").on(t.businessId)],
);

export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    durationMin: integer("duration_min").notNull(),
    priceCents: integer("price_cents").notNull(),
    // Services are archived, never deleted: bookings reference them.
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("services_business_idx").on(t.businessId)],
);

export const availability = sqliteTable(
  "availability",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    weekday: integer("weekday").notNull(), // ISO: 1 = Monday ... 7 = Sunday
    startMin: integer("start_min").notNull(), // minutes after local midnight
    endMin: integer("end_min").notNull(), // exclusive, max 1440
  },
  (t) => [index("availability_business_idx").on(t.businessId)],
);

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    startsAt: integer("starts_at").notNull(), // epoch ms, UTC
    endsAt: integer("ends_at").notNull(), // epoch ms, UTC
    status: text("status", { enum: ["confirmed", "cancelled"] })
      .notNull()
      .default("confirmed"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    // Last line of defence against double booking: two *confirmed* bookings can
    // never share a start time for one business. Partial overlaps (10:00-11:00 vs
    // 10:30-11:00) are caught by the overlap check inside the write transaction.
    uniqueIndex("bookings_active_start_uq")
      .on(t.businessId, t.startsAt)
      .where(sql`${t.status} = 'confirmed'`),
    index("bookings_business_start_idx").on(t.businessId, t.startsAt),
  ],
);

export type Business = typeof businesses.$inferSelect;
export type User = typeof users.$inferSelect;
export type Service = typeof services.$inferSelect;
export type AvailabilityRow = typeof availability.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Role = User["role"];
