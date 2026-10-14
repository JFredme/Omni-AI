export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const TASK_SORTS = ["manual", "due", "priority", "created", "updated", "title"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export const TASK_SORT_LABELS: Record<TaskSort, string> = {
  manual: "Manual order",
  due: "Due date",
  priority: "Priority",
  created: "Newest",
  updated: "Recently updated",
  title: "Title A–Z",
};

export const DUE_FILTERS = ["overdue", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** YYYY-MM-DD */
  dueDate: string | null;
  completedAt: string | null;
  tags: string[];
  position: number;
  projectId: string | null;
  projectName: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  parentId: string | null;
  subtasks: TaskDto[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskFilters {
  q?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  /** A project id, or "none" for tasks without a project. */
  projectId?: string;
  tag?: string;
  due?: DueFilter;
  sort?: TaskSort;
}

export function subtaskProgress(task: Pick<TaskDto, "subtasks">): { done: number; total: number } {
  return {
    done: task.subtasks.filter((subtask) => subtask.status === "done").length,
    total: task.subtasks.length,
  };
}
