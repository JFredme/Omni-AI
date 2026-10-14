import { zonedParts, zonedToUtc } from "@/lib/calendar/tz";

export type ScheduleSpec =
  | { frequency: "interval"; everyMinutes: number; timezone: string }
  | { frequency: "daily"; time: string; timezone: string }
  | { frequency: "weekly"; time: string; days: number[]; timezone: string };

export const MIN_INTERVAL_MINUTES = 5;

function parseClock(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(":").map(Number);
  return { hour, minute };
}

/** The first time the schedule fires strictly after `after`. */
export function nextRunAfter(spec: ScheduleSpec, after: Date): Date {
  if (spec.frequency === "interval") {
    return new Date(after.getTime() + Math.max(MIN_INTERVAL_MINUTES, spec.everyMinutes) * 60_000);
  }
  const { hour, minute } = parseClock(spec.time);
  const today = zonedParts(after, spec.timezone);
  const allowed = spec.frequency === "weekly" && spec.days.length ? new Set(spec.days) : null;
  // Look at today, then each following day, until a day matches and its time is still ahead.
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const candidate = zonedToUtc({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute, second: 0 }, spec.timezone);
    if (candidate <= after) continue;
    if (allowed && !allowed.has(date.getUTCDay())) continue;
    return candidate;
  }
  // Unreachable for valid input; fall back to a day later rather than looping forever.
  return new Date(after.getTime() + 86_400_000);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeSchedule(spec: ScheduleSpec): string {
  if (spec.frequency === "interval") {
    return spec.everyMinutes % 60 === 0 ? `Every ${spec.everyMinutes / 60 === 1 ? "hour" : `${spec.everyMinutes / 60} hours`}` : `Every ${spec.everyMinutes} minutes`;
  }
  if (spec.frequency === "daily") return `Every day at ${spec.time}`;
  return `${spec.days.length ? spec.days.map((day) => DAYS[day]).join(", ") : "Every week"} at ${spec.time}`;
}
