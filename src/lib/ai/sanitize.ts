import { isDateKey } from "@/lib/dates";
import { normalizeTags } from "@/lib/tags";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks/types";
import type {
  NoteSummaryProposal,
  OrganizeNoteSuggestion,
  OrganizeTaskSuggestion,
  PlanMilestone,
  PlanTask,
  PrioritySuggestion,
} from "./types";
import type {
  OrganizeNotesOutput,
  OrganizeTasksOutput,
  PlanOutput,
  PrioritiesOutput,
  SummaryOutput,
} from "./schemas";

/**
 * Model output is untrusted: it can invent ids, return values outside the allowed set, repeat itself,
 * or propose changes that change nothing. These functions turn it into proposals that are safe to show
 * and, once confirmed, safe to apply.
 */

export const MAX_PLAN_TASKS = 30;
export const MAX_PLAN_MILESTONES = 12;
export const MAX_SUBTASKS = 8;
export const MAX_SUGGESTED_TAGS = 5;
export const MAX_NEW_FOLDERS = 5;

function clean(value: string | null | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

function key(value: string): string {
  return value.trim().toLowerCase();
}

export function toPriority(value: string | null | undefined): TaskPriority | null {
  const normalized = key(value ?? "");
  return (TASK_PRIORITIES as readonly string[]).includes(normalized) ? (normalized as TaskPriority) : null;
}

function toDateKey(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return isDateKey(trimmed) ? trimmed : null;
}

export function sanitizePlan(
  raw: PlanOutput,
  context: { mode: "tasks" | "plan"; existingTaskTitles: string[]; existingMilestoneTitles: string[] },
): { summary: string; milestones: PlanMilestone[]; tasks: PlanTask[] } {
  const existingMilestones = new Map(context.existingMilestoneTitles.map((title) => [key(title), title]));

  const milestones: PlanMilestone[] = [];
  const proposedMilestones = new Map<string, string>();
  if (context.mode === "plan") {
    for (const item of raw.milestones ?? []) {
      const title = clean(item.title, 160);
      if (!title || existingMilestones.has(key(title)) || proposedMilestones.has(key(title))) continue;
      if (milestones.length >= MAX_PLAN_MILESTONES) break;
      proposedMilestones.set(key(title), title);
      milestones.push({ title, dueDate: toDateKey(item.dueDate) });
    }
  }

  const seen = new Set(context.existingTaskTitles.map(key));
  const tasks: PlanTask[] = [];
  for (const item of raw.tasks ?? []) {
    const title = clean(item.title, 200);
    if (!title || seen.has(key(title))) continue;
    if (tasks.length >= MAX_PLAN_TASKS) break;
    seen.add(key(title));

    const milestoneKey = key(item.milestone ?? "");
    const subtasks: string[] = [];
    for (const subtask of item.subtasks ?? []) {
      const subtaskTitle = clean(subtask, 200);
      if (subtaskTitle && !subtasks.some((existing) => key(existing) === key(subtaskTitle))) subtasks.push(subtaskTitle);
      if (subtasks.length >= MAX_SUBTASKS) break;
    }

    tasks.push({
      title,
      description: clean(item.description, 2_000),
      priority: toPriority(item.priority) ?? "medium",
      dueDate: toDateKey(item.dueDate),
      milestone: proposedMilestones.get(milestoneKey) ?? existingMilestones.get(milestoneKey) ?? null,
      tags: normalizeTags(item.tags ?? []).slice(0, MAX_SUGGESTED_TAGS),
      subtasks,
    });
  }

  return { summary: clean(raw.summary, 1_000), milestones, tasks };
}

export function sanitizeSummary(raw: SummaryOutput): Pick<NoteSummaryProposal, "summary" | "keyPoints" | "suggestedTags"> {
  const keyPoints = (raw.keyPoints ?? []).map((point) => clean(point, 300)).filter(Boolean).slice(0, 8);
  return {
    summary: clean(raw.summary, 4_000),
    keyPoints,
    suggestedTags: normalizeTags(raw.suggestedTags ?? []).slice(0, MAX_SUGGESTED_TAGS),
  };
}

export function sanitizePriorities(
  raw: PrioritiesOutput,
  tasks: { id: string; title: string; priority: TaskPriority }[],
): { summary: string; suggestions: PrioritySuggestion[] } {
  const known = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const suggestions: PrioritySuggestion[] = [];
  for (const item of raw.suggestions ?? []) {
    const task = known.get(item.taskId.trim());
    const suggested = toPriority(item.priority);
    if (!task || !suggested || suggested === task.priority || seen.has(task.id)) continue;
    seen.add(task.id);
    suggestions.push({
      taskId: task.id,
      title: task.title,
      current: task.priority,
      suggested,
      reason: clean(item.reason, 300),
    });
  }
  return { summary: clean(raw.summary, 1_000), suggestions };
}

export function sanitizeOrganizeTasks(
  raw: OrganizeTasksOutput,
  tasks: { id: string; title: string; projectId: string | null; tags: string[] }[],
  projects: { id: string; name: string }[],
): { summary: string; suggestions: OrganizeTaskSuggestion[] } {
  const knownTasks = new Map(tasks.map((task) => [task.id, task]));
  const knownProjects = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const suggestions: OrganizeTaskSuggestion[] = [];

  for (const item of raw.suggestions ?? []) {
    const task = knownTasks.get(item.taskId.trim());
    if (!task || seen.has(task.id)) continue;

    const project = knownProjects.get((item.projectId ?? "").trim());
    const projectId = project && project.id !== task.projectId ? project.id : null;
    const addTags = normalizeTags(item.addTags ?? [])
      .filter((tag) => !task.tags.includes(tag))
      .slice(0, MAX_SUGGESTED_TAGS);
    if (!projectId && addTags.length === 0) continue;

    seen.add(task.id);
    suggestions.push({
      taskId: task.id,
      title: task.title,
      projectId,
      projectName: projectId ? (knownProjects.get(projectId)?.name ?? null) : null,
      addTags,
      reason: clean(item.reason, 300),
    });
  }
  return { summary: clean(raw.summary, 1_000), suggestions };
}

export function sanitizeOrganizeNotes(
  raw: OrganizeNotesOutput,
  notes: { id: string; title: string; folderId: string | null; tags: string[] }[],
  folders: { id: string; name: string }[],
): { summary: string; suggestions: OrganizeNoteSuggestion[] } {
  const knownNotes = new Map(notes.map((note) => [note.id, note]));
  const foldersByName = new Map(folders.map((folder) => [key(folder.name), folder]));
  const seen = new Set<string>();
  const newFolders = new Map<string, string>();
  const suggestions: OrganizeNoteSuggestion[] = [];

  for (const item of raw.suggestions ?? []) {
    const note = knownNotes.get(item.noteId.trim());
    if (!note || seen.has(note.id)) continue;

    let folder: string | null = null;
    let newFolder = false;
    const requested = clean(item.folder, 60);
    if (requested) {
      const existing = foldersByName.get(key(requested));
      if (existing) {
        if (existing.id !== note.folderId) folder = existing.name;
      } else if (newFolders.has(key(requested))) {
        folder = newFolders.get(key(requested)) ?? null;
        newFolder = true;
      } else if (newFolders.size < MAX_NEW_FOLDERS) {
        newFolders.set(key(requested), requested);
        folder = requested;
        newFolder = true;
      }
    }

    const addTags = normalizeTags(item.addTags ?? [])
      .filter((tag) => !note.tags.includes(tag))
      .slice(0, MAX_SUGGESTED_TAGS);
    if (!folder && addTags.length === 0) continue;

    seen.add(note.id);
    suggestions.push({ noteId: note.id, title: note.title, folder, newFolder, addTags, reason: clean(item.reason, 300) });
  }
  return { summary: clean(raw.summary, 1_000), suggestions };
}
