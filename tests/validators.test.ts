import { describe, expect, it } from "vitest";
import {
  availabilitySchema,
  publicBookingSchema,
  serviceCreateSchema,
  signupSchema,
  slugSchema,
} from "../lib/validators";

describe("availabilitySchema", () => {
  const ok = (windows: unknown[]) => availabilitySchema.safeParse({ windows }).success;

  it("accepts non-overlapping windows, including back-to-back", () => {
    expect(ok([{ weekday: 1, startMin: 540, endMin: 720 }, { weekday: 1, startMin: 720, endMin: 1020 }])).toBe(true);
  });
  it("rejects overlapping windows on the same day", () => {
    expect(ok([{ weekday: 1, startMin: 540, endMin: 720 }, { weekday: 1, startMin: 700, endMin: 1020 }])).toBe(false);
  });
  it("allows the same hours on different days", () => {
    expect(ok([{ weekday: 1, startMin: 540, endMin: 720 }, { weekday: 2, startMin: 540, endMin: 720 }])).toBe(true);
  });
  it("rejects end <= start and out-of-range values", () => {
    expect(ok([{ weekday: 1, startMin: 600, endMin: 600 }])).toBe(false);
    expect(ok([{ weekday: 8, startMin: 540, endMin: 600 }])).toBe(false);
    expect(ok([{ weekday: 1, startMin: 540, endMin: 1441 }])).toBe(false);
  });
});

describe("slugSchema", () => {
  it.each(["demo-barber", "a1b", "tutor-2026"])("accepts %s", (s) => expect(slugSchema.safeParse(s).success).toBe(true));
  it.each(["ab", "-lead", "trail-", "double--dash", "Has Space", "under_score", "x".repeat(41)])("rejects %s", (s) =>
    expect(slugSchema.safeParse(s).success).toBe(false),
  );
  it("normalises case", () => expect(slugSchema.parse("  Demo-Shop ")).toBe("demo-shop"));
});

describe("signupSchema", () => {
  const base = { email: "Owner@Example.com ", password: "longenough", businessName: "Shop", slug: "shop", timezone: "Europe/Berlin" };
  it("normalises the email and defaults the currency", () => {
    const r = signupSchema.parse(base);
    expect(r.email).toBe("owner@example.com");
    expect(r.currency).toBe("USD");
  });
  it("rejects short passwords, bad timezones and unknown currencies", () => {
    expect(signupSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, timezone: "Nowhere/Land" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, currency: "XXX" }).success).toBe(false);
  });
});

describe("serviceCreateSchema", () => {
  it("requires integer minutes and cents within limits", () => {
    expect(serviceCreateSchema.safeParse({ name: "Cut", durationMin: 30, priceCents: 2500 }).success).toBe(true);
    expect(serviceCreateSchema.safeParse({ name: "Cut", durationMin: 2, priceCents: 2500 }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Cut", durationMin: 30, priceCents: 25.5 }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "  ", durationMin: 30, priceCents: 0 }).success).toBe(false);
  });
});

describe("publicBookingSchema", () => {
  it("requires a UTC ISO instant and a valid email", () => {
    const base = { serviceId: "s1", name: "Ada", email: "ada@example.com" };
    expect(publicBookingSchema.safeParse({ ...base, start: "2026-01-12T09:00:00.000Z" }).success).toBe(true);
    expect(publicBookingSchema.safeParse({ ...base, start: "2026-01-12 10:00" }).success).toBe(false);
    expect(publicBookingSchema.safeParse({ ...base, start: "2026-01-12T09:00:00Z", email: "nope" }).success).toBe(false);
  });
});
