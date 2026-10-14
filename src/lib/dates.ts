import { z } from "zod";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Zod schema for a date-only string (YYYY-MM-DD). */
export const dateKeySchema = z.string().refine(isDateKey, { message: "must be a date like 2026-03-01" });

/** Date-only values are stored as UTC midnight so they never shift with the server's time zone. */
export function dateKeyToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateToDateKey(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Today's date in the viewer's local time zone, as YYYY-MM-DD. */
export function localDateKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(key: string, days: number): string {
  const date = dateKeyToDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type DueState = "overdue" | "today" | "soon" | "later";

/** Classifies a due date relative to today. "soon" means within the next three days. */
export function dueState(due: string | null, today: string): DueState | null {
  if (!due) return null;
  if (due < today) return "overdue";
  if (due === today) return "today";
  return due <= addDays(today, 3) ? "soon" : "later";
}

export function formatDateKey(key: string): string {
  return dateKeyToDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
