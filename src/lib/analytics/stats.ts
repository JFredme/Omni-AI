import { addDays } from "@/lib/dates";
import { dateKeyIn } from "@/lib/calendar/tz";
import type { DayPoint } from "./types";

/** The dates, oldest first, of the `days` days ending on `endKey`. */
export function lastDays(endKey: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(endKey, i - (days - 1)));
}

/** Counts events per day (in `timeZone`) over the given days. Events outside those days are ignored. */
export function countByDay(instants: Date[], keys: string[], timeZone: string): DayPoint[] {
  const counts = new Map(keys.map((key) => [key, 0]));
  for (const instant of instants) {
    const key = dateKeyIn(instant, timeZone);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((date) => ({ date, value: counts.get(date) ?? 0 }));
}

/** Adds amounts per day (in `timeZone`) over the given days. */
export function sumByDay(items: { at: Date; amount: number }[], keys: string[], timeZone: string): DayPoint[] {
  const sums = new Map(keys.map((key) => [key, 0]));
  for (const item of items) {
    const key = dateKeyIn(item.at, timeZone);
    if (sums.has(key)) sums.set(key, (sums.get(key) ?? 0) + item.amount);
  }
  return keys.map((date) => ({ date, value: Math.round((sums.get(date) ?? 0) * 1000) / 1000 }));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const sum = (points: DayPoint[]) => points.reduce((total, point) => total + point.value, 0);
export const round1 = (value: number) => Math.round(value * 10) / 10;
