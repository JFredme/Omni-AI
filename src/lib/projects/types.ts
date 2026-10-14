export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

export interface ProjectStats {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
  /** Whole percent of top-level tasks that are done (0 when there are none). */
  progress: number;
}

export interface MilestoneDto {
  id: string;
  projectId: string;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  taskTotal: number;
  taskDone: number;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  dueDate: string | null;
  stats: ProjectStats;
  milestoneTotal: number;
  milestoneDone: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetailDto extends ProjectDto {
  milestones: MilestoneDto[];
}
