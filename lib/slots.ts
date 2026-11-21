import { DateTime, IANAZone } from "luxon";

/**
 * The slot engine. Pure functions, no I/O, so it is trivial to unit test.
 *
 *   free slots = availability windows (local wall-clock, business timezone)
 *                  - existing confirmed bookings (absolute UTC instants)
 *
 * Why wall-clock windows but UTC bookings: "open 09:00-17:00" is a statement about
 * the shop's clock, so on a DST-change day the window really is 1 hour shorter or
 * longer in absolute time. Bookings are instants, so they never move.
 */

export interface AvailabilityWindow {
  weekday: number; // ISO 1 = Mon ... 7 = Sun
  startMin: number; // minutes after local midnight
  endMin: number; // exclusive, <= 1440
}

export interface BusySpan {
  startsAt: number; // epoch ms
  endsAt: number; // epoch ms
}

export interface Slot {
  startsAt: number; // epoch ms (UTC)
  endsAt: number;
  /** "HH:mm" in the business timezone, for display. */
  local: string;
}

export interface SlotQuery {
  /** Calendar date in the *business* timezone, "YYYY-MM-DD". */
  date: string;
  timezone: string;
  durationMin: number;
  windows: AvailabilityWindow[];
  busy: BusySpan[];
  /** Injectable clock (epoch ms) for tests. Defaults to Date.now(). */
  now?: number;
  /** Distance between slot starts. Defaults to the service duration. */
  stepMin?: number;
  /** Slots starting sooner than this from `now` are hidden. */
  minNoticeMin?: number;
}

const MIN = 60_000;

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). Touching ends do not overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Local date ("YYYY-MM-DD") of an instant in a timezone. */
export function localDate(epochMs: number, timezone: string): string {
  return DateTime.fromMillis(epochMs, { zone: timezone }).toISODate() ?? "";
}

/** Absolute start (inclusive) and end (exclusive) of a local calendar day. */
export function dayBounds(date: string, timezone: string): { start: number; end: number } | null {
  const day = DateTime.fromISO(date, { zone: timezone });
  if (!day.isValid) return null;
  return { start: day.startOf("day").toMillis(), end: day.plus({ days: 1 }).startOf("day").toMillis() };
}

/** Wall-clock minute-of-day on a given local day -> absolute instant. */
function atLocalMinute(day: DateTime, minuteOfDay: number): number {
  if (minuteOfDay >= 1440) return day.plus({ days: 1 }).startOf("day").toMillis();
  // `set` keeps wall-clock semantics. (`plus({minutes})` would add *elapsed* time and
  // drift by an hour across a DST change.) Nonexistent local times (spring-forward gap)
  // are pushed forward by Luxon.
  return day
    .set({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60, second: 0, millisecond: 0 })
    .toMillis();
}

export function generateSlots(q: SlotQuery): Slot[] {
  const day = DateTime.fromISO(q.date, { zone: q.timezone });
  if (!day.isValid || q.durationMin <= 0) return [];

  const now = q.now ?? Date.now();
  const earliest = now + (q.minNoticeMin ?? 0) * MIN;
  const duration = q.durationMin * MIN;
  const step = (q.stepMin ?? q.durationMin) * MIN;

  const starts = new Set<number>();
  const slots: Slot[] = [];

  for (const w of q.windows.filter((w) => w.weekday === day.weekday)) {
    const windowStart = atLocalMinute(day, w.startMin);
    const windowEnd = atLocalMinute(day, w.endMin);

    for (let s = windowStart; s + duration <= windowEnd; s += step) {
      const e = s + duration;
      if (s < earliest || starts.has(s)) continue;
      if (q.busy.some((b) => overlaps(s, e, b.startsAt, b.endsAt))) continue;
      starts.add(s);
      slots.push({
        startsAt: s,
        endsAt: e,
        local: DateTime.fromMillis(s, { zone: q.timezone }).toFormat("HH:mm"),
      });
    }
  }

  return slots.sort((a, b) => a.startsAt - b.startsAt);
}
