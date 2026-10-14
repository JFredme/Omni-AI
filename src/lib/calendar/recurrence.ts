import { dateKeyOf, dateKeyIn, zonedParts, zonedToUtc } from "./tz";

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface Recurrence {
  freq: Frequency;
  /** Every N days/weeks/months/years. */
  interval: number;
  /** Weekly only: days of the week (0 = Sunday) the event falls on. Defaults to the start day. */
  byDay?: number[];
  /** Last date (YYYY-MM-DD, in the event's time zone) an occurrence can start on. */
  until?: string;
  /** Total number of occurrences, counting the first. */
  count?: number;
}

export interface Repeating {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timezone: string;
  recurrence: Recurrence | null;
  /** Dates (YYYY-MM-DD) whose occurrence was removed or moved. */
  exdates: string[];
}

export interface Occurrence {
  start: Date;
  end: Date;
  /** The date of this occurrence, in the event's time zone. Identifies it within a series. */
  key: string;
}

const MAX_OCCURRENCES = 1_000;
const DAY = 86_400_000;

interface Ymd {
  year: number;
  month: number;
  day: number;
}

const utcDay = (date: Ymd) => Date.UTC(date.year, date.month - 1, date.day);
const fromUtcDay = (ms: number): Ymd => {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const weekday = (date: Ymd) => new Date(utcDay(date)).getUTCDay();
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Local start dates of the series, in order, each paired with a flag for "counts toward COUNT". */
function* localDates(base: Ymd, rule: Recurrence, skipBefore: number): Generator<Ymd> {
  const interval = Math.max(1, rule.interval);
  const baseMs = utcDay(base);
  if (rule.freq === "daily") {
    const first = Math.max(0, Math.floor((skipBefore - baseMs) / DAY / interval) - 1);
    for (let n = first; ; n++) yield fromUtcDay(baseMs + n * interval * DAY);
  } else if (rule.freq === "weekly") {
    const days = [...new Set(rule.byDay?.length ? rule.byDay : [weekday(base)])].sort((a, b) => a - b);
    const weekStart = baseMs - weekday(base) * DAY;
    const first = Math.max(0, Math.floor((skipBefore - weekStart) / (7 * DAY) / interval) - 1);
    for (let w = first; ; w++) {
      for (const day of days) {
        const ms = weekStart + w * interval * 7 * DAY + day * DAY;
        if (ms >= baseMs) yield fromUtcDay(ms);
      }
    }
  } else if (rule.freq === "monthly") {
    const first = Math.max(0, Math.floor(((new Date(skipBefore).getUTCFullYear() - base.year) * 12 + new Date(skipBefore).getUTCMonth() + 1 - base.month) / interval) - 1);
    for (let n = first; ; n++) {
      const index = base.month - 1 + n * interval;
      const year = base.year + Math.floor(index / 12);
      const month = (index % 12) + 1;
      // A month without this day (the 31st, say) is skipped, as in iCalendar.
      if (base.day <= daysInMonth(year, month)) yield { year, month, day: base.day };
    }
  } else {
    const first = Math.max(0, Math.floor((new Date(skipBefore).getUTCFullYear() - base.year) / interval) - 1);
    for (let n = first; ; n++) {
      const year = base.year + n * interval;
      if (base.day <= daysInMonth(year, base.month)) yield { year, month: base.month, day: base.day };
    }
  }
}

/** Every occurrence of an event that overlaps [rangeStart, rangeEnd). A non-repeating event is its own single occurrence. */
export function expandOccurrences(event: Repeating, rangeStart: Date, rangeEnd: Date, limit = MAX_OCCURRENCES): Occurrence[] {
  const { startsAt, endsAt, allDay, timezone, recurrence } = event;
  const overlaps = (start: Date, end: Date) => start < rangeEnd && (end > rangeStart || (end.getTime() === start.getTime() && start >= rangeStart));
  const keyOf = (start: Date) => (allDay ? start.toISOString().slice(0, 10) : dateKeyIn(start, timezone));

  if (!recurrence) {
    return overlaps(startsAt, endsAt) ? [{ start: startsAt, end: endsAt, key: keyOf(startsAt) }] : [];
  }

  const first = allDay
    ? { ...fromUtcDay(startsAt.getTime()), hour: 0, minute: 0, second: 0 }
    : zonedParts(startsAt, timezone);
  const base: Ymd = { year: first.year, month: first.month, day: first.day };
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const excluded = new Set(event.exdates);
  const until = recurrence.until ?? null;
  // Start looking a little before the range, since an occurrence can begin earlier and run into it.
  const skipBefore = rangeStart.getTime() - Math.max(durationMs, 0) - 2 * DAY;

  const result: Occurrence[] = [];
  let produced = 0;
  let guard = 0;
  // With a COUNT every occurrence from the start must be counted, so don't skip ahead.
  for (const date of localDates(base, recurrence, recurrence.count ? Number.NEGATIVE_INFINITY : skipBefore)) {
    if (++guard > 20_000) break;
    const key = dateKeyOf(date);
    if (until && key > until) break;
    if (recurrence.count && produced >= recurrence.count) break;
    produced += 1;

    const start = allDay ? new Date(utcDay(date)) : zonedToUtc({ ...date, hour: first.hour, minute: first.minute, second: first.second }, timezone);
    if (start >= rangeEnd) break;
    if (excluded.has(key)) continue;
    const end = new Date(start.getTime() + durationMs);
    if (overlaps(start, end)) {
      result.push({ start, end, key });
      if (result.length >= limit) break;
    }
  }
  return result;
}
