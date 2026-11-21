import { bigint, boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Time model: every instant is stored as epoch milliseconds (UTC) in a bigint column.
 * Availability windows are the exception: they are *local wall-clock* minutes
 * in the business timezone ("09:00" means 09:00 wherever the shop is, DST included).
 *
 * If you change this file, mirror the change in lib/migrate.ts. The booking-overlap
 * EXCLUDE constraint only exists there (Drizzle cannot express it).
 */

const ms = (name: string) => bigint(name, { mode: "number" });

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull(), // IANA, e.g. "Europe/Berlin"
  currency: text("currency").notNull().default("USD"),
  createdAt: ms("created_at").notNull(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner", "staff"] }).notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("users_business_idx").on(t.businessId)],
);

export const services = pgTable(
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
    active: boolean("active").notNull().default(true),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("services_business_idx").on(t.businessId)],
);

export const availability = pgTable(
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

export const bookings = pgTable(
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
    startsAt: ms("starts_at").notNull(), // epoch ms, UTC
    endsAt: ms("ends_at").notNull(), // epoch ms, UTC
    status: text("status", { enum: ["confirmed", "cancelled"] })
      .notNull()
      .default("confirmed"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("bookings_business_start_idx").on(t.businessId, t.startsAt)],
);

export type Business = typeof businesses.$inferSelect;
export type User = typeof users.$inferSelect;
export type Service = typeof services.$inferSelect;
export type AvailabilityRow = typeof availability.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Role = User["role"];
