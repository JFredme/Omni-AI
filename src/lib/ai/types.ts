import type { TaskPriority } from "@/lib/tasks/types";

/** What the assistant proposes. Nothing here is saved until the user confirms. */

export interface PlanMilestone {
  title: string;
  dueDate: string | null;
}

export interface PlanTask {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  /** Title of a milestone (proposed or existing) this task belongs to. */
  milestone: string | null;
  tags: string[];
  subtasks: string[];
}

export interface ProjectPlanProposal {
  kind: "project_plan";
  mode: "tasks" | "plan";
  projectId: string;
  summary: string;
  milestones: PlanMilestone[];
  tasks: PlanTask[];
}

export interface NoteSummaryProposal {
  kind: "note_summary";
  noteId: string;
  summary: string;
  keyPoints: string[];
  suggestedTags: string[];
  /** True when the note was too long and only its beginning was summarized. */
  truncated: boolean;
}

export interface PrioritySuggestion {
  taskId: string;
  title: string;
  current: TaskPriority;
  suggested: TaskPriority;
  reason: string;
}

export interface TaskPrioritiesProposal {
  kind: "task_priorities";
  summary: string;
  reviewed: number;
  suggestions: PrioritySuggestion[];
}

export interface OrganizeTaskSuggestion {
  taskId: string;
  title: string;
  /** Project to move the task into, or null to leave its project alone. */
  projectId: string | null;
  projectName: string | null;
  addTags: string[];
  reason: string;
}

export interface OrganizeTasksProposal {
  kind: "organize_tasks";
  summary: string;
  reviewed: number;
  suggestions: OrganizeTaskSuggestion[];
}

export interface OrganizeNoteSuggestion {
  noteId: string;
  title: string;
  /** Folder name to file the note under, or null to leave it where it is. */
  folder: string | null;
  /** True when the folder doesn't exist yet and would be created. */
  newFolder: boolean;
  addTags: string[];
  reason: string;
}

export interface OrganizeNotesProposal {
  kind: "organize_notes";
  summary: string;
  reviewed: number;
  suggestions: OrganizeNoteSuggestion[];
}

export type Proposal =
  | ProjectPlanProposal
  | NoteSummaryProposal
  | TaskPrioritiesProposal
  | OrganizeTasksProposal
  | OrganizeNotesProposal;

export interface ProposeResponse {
  proposal: Proposal;
  modelId: string;
}

export interface ApplyResponse {
  applied: number;
  skipped: number;
  message: string;
}
