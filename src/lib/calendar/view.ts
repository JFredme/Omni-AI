// Pure helpers for laying out the calendar views.
import { addDays } from "@/lib/dates";
import { dateKeyIn, zonedParts, zonedToUtc } from "./tz";
import type { OccurrenceDto } from "./types";

export type CalendarView = "month" | "week" | "agenda";

const parse = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};
const keyOf = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** 0 = Sunday. */
export function weekdayOf(key: string): number {
  const { year, month, day } = parse(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfWeek(key: string): string {
  return addDays(key, -weekdayOf(key));
}

export function weekDays(key: string): string[] {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Six rows of seven dates covering the month, starting on Sunday. */
export function monthGrid(key: string): string[][] {
  const { year, month } = parse(key);
  const first = startOfWeek(keyOf(year, month, 1));
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(first, week * 7 + day)));
}

export function shiftMonth(key: string, months: number): string {
  const { year, month } = parse(key);
  const index = year * 12 + (month - 1) + months;
  return keyOf(Math.floor(index / 12), (index % 12) + 1, 1);
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** The instants spanning every day the view shows, in the viewer's zone. */
export function rangeForView(view: CalendarView, cursor: string, timeZone: string): { from: Date; to: Date } {
  let firstDay: string;
  let lastDay: string;
  if (view === "month") {
    const grid = monthGrid(cursor);
    firstDay = grid[0][0];
    lastDay = grid[5][6];
  } else if (view === "week") {
    const days = weekDays(cursor);
    firstDay = days[0];
    lastDay = days[6];
  } else {
    firstDay = cursor;
    lastDay = addDays(cursor, 29);
  }
  const midnight = (key: string) => zonedToUtc({ ...parse(key), hour: 0, minute: 0, second: 0 }, timeZone);
  return { from: midnight(firstDay), to: midnight(addDays(lastDay, 1)) };
}

/** The dates (in the viewer's zone) an occurrence appears on. All-day events cover each day; timed ones show on the day they start. */
export function occurrenceDays(occurrence: Pick<OccurrenceDto, "start" | "end" | "allDay">, timeZone: string): string[] {
  if (!occurrence.allDay) return [dateKeyIn(new Date(occurrence.start), timeZone)];
  const first = occurrence.start.slice(0, 10);
  const lastExclusive = occurrence.end.slice(0, 10);
  const days: string[] = [];
  for (let day = first; day < lastExclusive && days.length < 400; day = addDays(day, 1)) days.push(day);
  return days.length ? days : [first];
}

export function minutesIntoDay(iso: string, timeZone: string): number {
  const parts = zonedParts(new Date(iso), timeZone);
  return parts.hour * 60 + parts.minute;
}

/** Puts overlapping blocks side by side. Returns, per id, which lane it sits in and how many lanes its cluster has. */
export function layoutLanes(blocks: { id: string; start: number; end: number }[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number; end: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    for (const item of cluster) result.set(item.id, { lane: item.lane, lanes });
    cluster = [];
  };
  for (const block of sorted) {
    if (block.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter((item) => item.end > block.start).map((item) => item.lane));
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    cluster.push({ id: block.id, lane, end: block.end });
    clusterEnd = cluster.length === 1 ? block.end : Math.max(clusterEnd, block.end);
  }
  flush();
  return result;
}

export function formatTimeRange(startIso: string, endIso: string, allDay: boolean, locale?: string): string {
  if (allDay) return "All day";
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const start = new Date(startIso);
  const end = new Date(endIso);
  return end.getTime() === start.getTime() ? start.toLocaleTimeString(locale, opts) : `${start.toLocaleTimeString(locale, opts)} – ${end.toLocaleTimeString(locale, opts)}`;
}
