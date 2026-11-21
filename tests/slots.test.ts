import { describe, expect, it } from "vitest";
import {
  dayBounds,
  generateSlots,
  isValidTimezone,
  localDate,
  overlaps,
  type AvailabilityWindow,
  type SlotQuery,
} from "../lib/slots";

const utc = (iso: string) => Date.parse(iso);
const win = (weekday: number, from: string, to: string): AvailabilityWindow => {
  const toMin = (s: string) => Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
  return { weekday, startMin: toMin(from), endMin: toMin(to) };
};

// A fixed "now" well before every test date so the clock never hides slots by accident.
const LONG_AGO = utc("2025-12-01T00:00:00Z");

function slots(partial: Partial<SlotQuery> & Pick<SlotQuery, "date" | "windows">) {
  return generateSlots({
    timezone: "Europe/Berlin",
    durationMin: 60,
    busy: [],
    now: LONG_AGO,
    ...partial,
  });
}
const locals = (s: ReturnType<typeof slots>) => s.map((x) => x.local);

describe("overlaps", () => {
  it("detects partial and full overlap", () => {
    expect(overlaps(10, 20, 15, 25)).toBe(true);
    expect(overlaps(10, 20, 12, 18)).toBe(true);
    expect(overlaps(10, 20, 5, 25)).toBe(true);
  });
  it("treats touching intervals as NOT overlapping (half-open)", () => {
    expect(overlaps(10, 20, 20, 30)).toBe(false);
    expect(overlaps(10, 20, 0, 10)).toBe(false);
  });
  it("is false for disjoint intervals", () => {
    expect(overlaps(10, 20, 30, 40)).toBe(false);
  });
});

describe("generateSlots: basics", () => {
  // 2026-01-12 is a Monday (ISO weekday 1).
  it("fills a window with back-to-back slots", () => {
    expect(locals(slots({ date: "2026-01-12", windows: [win(1, "09:00", "12:00")] }))).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("returns nothing on a weekday with no window", () => {
    expect(slots({ date: "2026-01-13", windows: [win(1, "09:00", "12:00")] })).toEqual([]);
  });

  it("does not emit a slot that would run past the end of the window", () => {
    // 45-min service in 09:00-10:30 fits exactly twice; a third would end at 11:15.
    const r = slots({ date: "2026-01-12", durationMin: 45, windows: [win(1, "09:00", "10:30")] });
    expect(locals(r)).toEqual(["09:00", "09:45"]);
  });

  it("supports a finer step than the duration", () => {
    const r = slots({ date: "2026-01-12", stepMin: 30, windows: [win(1, "09:00", "11:00")] });
    expect(locals(r)).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("handles split shifts (lunch break)", () => {
    const r = slots({ date: "2026-01-12", windows: [win(1, "09:00", "12:00"), win(1, "13:00", "15:00")] });
    expect(locals(r)).toEqual(["09:00", "10:00", "11:00", "13:00", "14:00"]);
  });

  it("de-duplicates when windows overlap", () => {
    const r = slots({ date: "2026-01-12", windows: [win(1, "09:00", "11:00"), win(1, "10:00", "12:00")] });
    expect(locals(r)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("supports a window that runs to the end of the day (24:00)", () => {
    const r = slots({ date: "2026-01-12", windows: [{ weekday: 1, startMin: 22 * 60, endMin: 1440 }] });
    expect(locals(r)).toEqual(["22:00", "23:00"]);
  });

  it("returns [] for an invalid date or a zero duration", () => {
    expect(slots({ date: "not-a-date", windows: [win(1, "09:00", "12:00")] })).toEqual([]);
    expect(slots({ date: "2026-01-12", durationMin: 0, windows: [win(1, "09:00", "12:00")] })).toEqual([]);
  });
});

describe("generateSlots: existing bookings", () => {
  const windows = [win(1, "09:00", "12:00")];
  // Berlin is UTC+1 in January: 10:00 local = 09:00Z.

  it("removes a slot that is exactly booked", () => {
    const busy = [{ startsAt: utc("2026-01-12T09:00:00Z"), endsAt: utc("2026-01-12T10:00:00Z") }];
    expect(locals(slots({ date: "2026-01-12", windows, busy }))).toEqual(["09:00", "11:00"]);
  });

  it("removes every slot a partially overlapping booking touches", () => {
    // 10:30-11:30 local clips both the 10:00 and the 11:00 slot.
    const busy = [{ startsAt: utc("2026-01-12T09:30:00Z"), endsAt: utc("2026-01-12T10:30:00Z") }];
    expect(locals(slots({ date: "2026-01-12", windows, busy }))).toEqual(["09:00"]);
  });

  it("keeps slots that merely touch a booking", () => {
    const busy = [{ startsAt: utc("2026-01-12T08:00:00Z"), endsAt: utc("2026-01-12T09:00:00Z") }]; // 09:00-10:00 local
    expect(locals(slots({ date: "2026-01-12", windows, busy }))).toEqual(["10:00", "11:00"]);
  });
});

describe("generateSlots: the clock", () => {
  const windows = [win(1, "09:00", "12:00")];

  it("hides slots that already started", () => {
    // 09:45 local = 08:45Z
    const r = slots({ date: "2026-01-12", windows, now: utc("2026-01-12T08:45:00Z") });
    expect(locals(r)).toEqual(["10:00", "11:00"]);
  });

  it("applies minimum notice", () => {
    // now 09:45 local + 30 min notice => earliest 10:15, so 10:00 is gone too
    const r = slots({ date: "2026-01-12", windows, now: utc("2026-01-12T08:45:00Z"), minNoticeMin: 30 });
    expect(locals(r)).toEqual(["11:00"]);
  });
});

describe("generateSlots: timezones", () => {
  it("converts wall-clock windows to the right UTC instants (half-hour offset: Kolkata)", () => {
    const [s] = slots({ date: "2026-01-12", timezone: "Asia/Kolkata", windows: [win(1, "09:00", "10:00")] });
    expect(new Date(s!.startsAt).toISOString()).toBe("2026-01-12T03:30:00.000Z");
  });

  it("uses summer vs winter offsets (New York 09:00 = 13:00Z in July, 14:00Z in January)", () => {
    const summer = slots({ date: "2026-07-13", timezone: "America/New_York", windows: [win(1, "09:00", "10:00")] });
    const winter = slots({ date: "2026-01-12", timezone: "America/New_York", windows: [win(1, "09:00", "10:00")] });
    expect(new Date(summer[0]!.startsAt).toISOString()).toBe("2026-07-13T13:00:00.000Z");
    expect(new Date(winter[0]!.startsAt).toISOString()).toBe("2026-01-12T14:00:00.000Z");
  });

  it("a local day can start on the previous UTC day (Auckland)", () => {
    const [s] = slots({ date: "2026-06-15", timezone: "Pacific/Auckland", windows: [win(1, "09:00", "10:00")] });
    expect(new Date(s!.startsAt).toISOString()).toBe("2026-06-14T21:00:00.000Z"); // UTC date is the 14th...
    expect(localDate(s!.startsAt, "Pacific/Auckland")).toBe("2026-06-15"); // ...but it is the 15th at the shop
  });

  it("spring-forward day is one hour short: the non-existent 02:00 hour is skipped", () => {
    // New York, Sunday 2026-03-08: clocks jump 02:00 -> 03:00. Window 01:00-05:00 is only 3 real hours.
    const r = slots({ date: "2026-03-08", timezone: "America/New_York", windows: [win(7, "01:00", "05:00")] });
    expect(locals(r)).toEqual(["01:00", "03:00", "04:00"]);
    expect(r.map((s) => new Date(s.startsAt).toISOString())).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
    ]);
  });

  it("fall-back day is one hour long: 01:00 happens twice and both are bookable", () => {
    // New York, Sunday 2026-11-01: clocks go 02:00 -> 01:00. Window 00:00-03:00 is 4 real hours.
    const r = slots({ date: "2026-11-01", timezone: "America/New_York", windows: [win(7, "00:00", "03:00")] });
    expect(r.map((s) => new Date(s.startsAt).toISOString())).toEqual([
      "2026-11-01T04:00:00.000Z", // 00:00 EDT
      "2026-11-01T05:00:00.000Z", // 01:00 EDT
      "2026-11-01T06:00:00.000Z", // 01:00 EST (second occurrence)
      "2026-11-01T07:00:00.000Z", // 02:00 EST
    ]);
  });

  it("dayBounds reflects 23-hour and 25-hour days", () => {
    const spring = dayBounds("2026-03-08", "America/New_York")!;
    const fall = dayBounds("2026-11-01", "America/New_York")!;
    expect((spring.end - spring.start) / 3_600_000).toBe(23);
    expect((fall.end - fall.start) / 3_600_000).toBe(25);
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Phobos")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
