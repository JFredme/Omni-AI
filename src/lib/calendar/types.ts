// Client-safe calendar types.
import type { Recurrence } from "./recurrence";

export type { Recurrence };

export interface EventDto {
  id: string;
  uid: string;
  title: string;
  description: string;
  location: string;
  /** ISO instant. For all-day events, UTC midnight of the first day. */
  startsAt: string;
  /** ISO instant, exclusive. For all-day events, UTC midnight of the day after the last day. */
  endsAt: string;
  allDay: boolean;
  timezone: string;
  recurrence: Recurrence | null;
  exdates: string[];
  taskId: string | null;
  taskTitle: string | null;
}

/** One showing of an event on the calendar. A repeating event has one per date. */
export interface OccurrenceDto {
  eventId: string;
  /** The occurrence's date in the event's zone; with eventId it identifies the showing. */
  key: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  recurring: boolean;
  taskId: string | null;
}

export interface CalendarTaskDto {
  id: string;
  title: string;
  dueDate: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "todo" | "in_progress" | "done";
}

export interface CalendarMilestoneDto {
  id: string;
  title: string;
  dueDate: string;
  projectId: string;
  projectName: string;
  completed: boolean;
}

export interface CalendarRangeDto {
  occurrences: OccurrenceDto[];
  tasks: CalendarTaskDto[];
  milestones: CalendarMilestoneDto[];
}

export const REPEAT_LABELS: Record<Recurrence["freq"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const MAX_EVENT_DAYS = 366;
