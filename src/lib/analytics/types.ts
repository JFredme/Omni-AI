// Client-safe shapes for the analytics page.

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export interface DayPoint {
  date: string;
  value: number;
}

export interface AnalyticsDto {
  days: number;
  timezone: string;
  from: string;
  to: string;
  tasks: {
    created: DayPoint[];
    completed: DayPoint[];
    totals: { created: number; completed: number; open: number; overdue: number };
    /** Median days from creating a task to finishing it, for tasks finished in the range. Null when none were. */
    medianDaysToComplete: number | null;
    /** Finished in the range as a share of everything created in it, so it can pass 100% when old tasks are cleared. */
    completedPerCreated: number | null;
    byPriority: { priority: "low" | "medium" | "high" | "urgent"; open: number; completed: number }[];
    byProject: { name: string; open: number; completed: number }[];
  };
  time: {
    scheduledHoursByDay: DayPoint[];
    focusHoursByDay: DayPoint[];
    totalScheduledHours: number;
    totalFocusHours: number;
  };
  ai: {
    spendByDay: DayPoint[];
    requestsByDay: DayPoint[];
    totals: { requests: number; failedRequests: number; totalTokens: number; costUsd: number; unknownCostRequests: number };
    byModel: { modelId: string; requests: number; totalTokens: number; costUsd: number }[];
    month: { spendUsd: number; budgetUsd: number | null };
  };
  activity: {
    conversations: number;
    messagesSent: number;
    notesCreated: number;
    documentsAdded: number;
    researchReports: number;
    calendarEventsCreated: number;
    agentRuns: Record<string, number>;
    automationRuns: Record<string, number>;
  };
}
