export interface DashboardTask {
  id: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  projectName: string | null;
  status: "todo" | "in_progress" | "done";
}

export interface DashboardDto {
  today: string;
  counts: { open: number; overdue: number; dueToday: number; inProgress: number; conversations: number };
  overdue: DashboardTask[];
  dueToday: DashboardTask[];
  inProgress: DashboardTask[];
  projects: { id: string; name: string; dueDate: string | null; progress: number; total: number; done: number; overdue: number }[];
  notes: { id: string; title: string; excerpt: string; updatedAt: string; pinned: boolean }[];
  runs: { id: string; agentName: string; objective: string; status: string; createdAt: string }[];
  spend: { monthUsd: number; budgetUsd: number | null };
}
