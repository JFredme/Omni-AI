/** Time-zone helpers built on Intl, so recurring events keep their local wall-clock time across daylight saving. */

export interface Parts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading in `timeZone` at the given instant. */
export function zonedParts(instant: Date, timeZone: string): Parts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day, hour: values.hour % 24, minute: values.minute, second: values.second };
}

const asUtc = (parts: Parts) => Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

/** How far ahead of UTC the zone is at this instant, in milliseconds. */
export function offsetMs(instant: Date, timeZone: string): number {
  return asUtc(zonedParts(instant, timeZone)) - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `parts`. When a time doesn't exist (spring-forward gap) it
 * lands just after the gap; when it happens twice (fall-back) the earlier one is used.
 */
export function zonedToUtc(parts: Parts, timeZone: string): Date {
  const guess = asUtc(parts);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  if (first === second) return new Date(first);
  // The offset changed between the two readings: we're near a transition.
  const check = zonedParts(new Date(second), timeZone);
  return new Date(asUtc(check) === guess ? second : Math.max(first, second));
}

export function dateKeyOf(parts: Pick<Parts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** The calendar date (YYYY-MM-DD) of an instant, as seen in `timeZone`. */
export function dateKeyIn(instant: Date, timeZone: string): string {
  return dateKeyOf(zonedParts(instant, timeZone));
}
