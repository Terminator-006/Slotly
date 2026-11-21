import { z } from "zod";
import { CURRENCIES } from "./format";
import { isValidTimezone } from "./slots";

/** Every API route parses its input with one of these. Nothing unvalidated reaches the DB. */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(40, "Use at most 40 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only");

export const timezoneSchema = z.string().refine(isValidTimezone, "Unknown timezone");

export const currencySchema = z.enum(CURRENCIES);

const businessNameSchema = z.string().trim().min(2, "Too short").max(80, "Too long");

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  businessName: businessNameSchema,
  slug: slugSchema,
  timezone: timezoneSchema,
  currency: currencySchema.default("USD"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const businessPatchSchema = z
  .object({
    name: businessNameSchema,
    slug: slugSchema,
    timezone: timezoneSchema,
    currency: currencySchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const serviceFields = {
  name: z.string().trim().min(1, "Required").max(80),
  durationMin: z.number().int().min(5).max(480),
  priceCents: z.number().int().min(0).max(10_000_000),
};

export const serviceCreateSchema = z.object(serviceFields);

export const servicePatchSchema = z
  .object({ ...serviceFields, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const availabilitySchema = z
  .object({
    windows: z
      .array(
        z.object({
          weekday: z.number().int().min(1).max(7),
          startMin: z.number().int().min(0).max(1439),
          endMin: z.number().int().min(1).max(1440),
        }),
      )
      .max(70),
  })
  .superRefine((val, ctx) => {
    const byDay = new Map<number, { startMin: number; endMin: number }[]>();
    val.windows.forEach((w, i) => {
      if (w.endMin <= w.startMin) {
        ctx.addIssue({ code: "custom", path: ["windows", i], message: "End must be after start" });
      }
      byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
    });
    for (const list of byDay.values()) {
      const sorted = [...list].sort((a, b) => a.startMin - b.startMin);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.startMin < sorted[i - 1]!.endMin) {
          ctx.addIssue({ code: "custom", path: ["windows"], message: "Windows on the same day must not overlap" });
          return;
        }
      }
    }
  });

export const slotsQuerySchema = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

export const publicBookingSchema = z.object({
  serviceId: z.string().min(1),
  /** ISO-8601 UTC instant, exactly as returned by the slots endpoint. */
  start: z.iso.datetime(),
  name: z.string().trim().min(1, "Required").max(100),
  email: emailSchema,
});

export const staffCreateSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const bookingsQuerySchema = z.object({
  scope: z.enum(["upcoming", "past", "all"]).default("upcoming"),
});
