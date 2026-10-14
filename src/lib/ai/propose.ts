import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { dateToDateKey, localDateKey } from "@/lib/dates";
import { makeExcerpt } from "@/lib/notes/logic";
import { PROJECT_STATUS_LABELS } from "@/lib/projects/types";
import {
  organizeNotesPrompt,
  organizeTasksPrompt,
  planPrompt,
  prioritiesPrompt,
  summaryPrompt,
} from "./prompts";
import { runAiJson } from "./run";
import {
  organizeNotesOutputSchema,
  organizeTasksOutputSchema,
  planOutputSchema,
  prioritiesOutputSchema,
  summaryOutputSchema,
  type ProposeRequest,
} from "./schemas";
import {
  sanitizeOrganizeNotes,
  sanitizeOrganizeTasks,
  sanitizePlan,
  sanitizePriorities,
  sanitizeSummary,
} from "./sanitize";
import type { ProposeResponse } from "./types";

/** Notes longer than this are summarized from their beginning only. */
export const MAX_SUMMARY_INPUT_CHARS = 24_000;
/** At most this many tasks/notes are sent in one review so the request stays small and cheap. */
export const MAX_REVIEW_ITEMS = 60;

type Kind<K extends ProposeRequest["kind"]> = Extract<ProposeRequest, { kind: K }>;

async function proposeProjectPlan(request: Kind<"project_plan">, signal?: AbortSignal): Promise<ProposeResponse> {
  const project = await prisma.project.findUnique({
    where: { id: request.projectId },
    include: {
      milestones: { select: { title: true } },
      tasks: { where: { parentId: null }, select: { title: true, status: true } },
    },
  });
  if (!project) throw new ApiError(404, "not_found", "That project no longer exists.");

  const existingMilestoneTitles = project.milestones.map((milestone) => milestone.title);
  const { system, user } = planPrompt({
    mode: request.mode,
    today: localDateKey(),
    goal: request.goal,
    project: {
      name: project.name,
      description: project.description,
      status: PROJECT_STATUS_LABELS[project.status],
      dueDate: dateToDateKey(project.dueDate),
    },
    milestones: existingMilestoneTitles,
    tasks: project.tasks,
  });
  const { data, modelId } = await runAiJson({ system, user, schema: planOutputSchema, modelId: request.modelId, signal });

  const plan = sanitizePlan(data, {
    mode: request.mode,
    existingTaskTitles: project.tasks.map((task) => task.title),
    existingMilestoneTitles,
  });
  if (plan.tasks.length === 0 && plan.milestones.length === 0) {
    throw new ApiError(422, "nothing_proposed", "The assistant didn't suggest anything new for this project. Add more detail to the description and try again.");
  }
  return { modelId, proposal: { kind: "project_plan", mode: request.mode, projectId: project.id, ...plan } };
}

async function proposeNoteSummary(request: Kind<"note_summary">, signal?: AbortSignal): Promise<ProposeResponse> {
  const note = await prisma.note.findUnique({ where: { id: request.noteId } });
  if (!note) throw new ApiError(404, "not_found", "That note no longer exists.");
  if (!note.content.trim()) throw new ApiError(400, "note_empty", "Write something in the note before summarizing it.");

  const truncated = note.content.length > MAX_SUMMARY_INPUT_CHARS;
  const { system, user } = summaryPrompt({ title: note.title, content: note.content.slice(0, MAX_SUMMARY_INPUT_CHARS) });
  const { data, modelId } = await runAiJson({ system, user, schema: summaryOutputSchema, modelId: request.modelId, signal });

  const summary = sanitizeSummary(data);
  if (!summary.summary) throw new ApiError(502, "ai_invalid_response", "The model returned an empty summary. Try again.");
  return { modelId, proposal: { kind: "note_summary", noteId: note.id, truncated, ...summary } };
}

async function proposeTaskPriorities(request: Kind<"task_priorities">, signal?: AbortSignal): Promise<ProposeResponse> {
  const rows = await prisma.task.findMany({
    where: {
      parentId: null,
      status: { not: "done" },
      ...(request.taskIds?.length ? { id: { in: request.taskIds } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_REVIEW_ITEMS,
    include: { project: { select: { name: true } } },
  });
  if (rows.length === 0) throw new ApiError(400, "nothing_to_review", "There are no open tasks to review.");

  const today = localDateKey();
  const { system, user } = prioritiesPrompt({
    today,
    tasks: rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      dueDate: dateToDateKey(row.dueDate),
      project: row.project?.name ?? null,
    })),
  });
  const { data, modelId } = await runAiJson({ system, user, schema: prioritiesOutputSchema, modelId: request.modelId, signal });
  const result = sanitizePriorities(
    data,
    rows.map((row) => ({ id: row.id, title: row.title, priority: row.priority })),
  );
  return { modelId, proposal: { kind: "task_priorities", reviewed: rows.length, ...result } };
}

async function proposeOrganizeTasks(request: Kind<"organize_tasks">, signal?: AbortSignal): Promise<ProposeResponse> {
  const [rows, projects] = await Promise.all([
    prisma.task.findMany({
      where: { parentId: null, status: { not: "done" } },
      orderBy: [{ projectId: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }],
      take: MAX_REVIEW_ITEMS,
    }),
    prisma.project.findMany({ where: { status: { in: ["planning", "active", "on_hold"] } }, orderBy: { name: "asc" }, take: 40 }),
  ]);
  if (rows.length === 0) throw new ApiError(400, "nothing_to_review", "There are no open tasks to organize.");

  const { system, user } = organizeTasksPrompt({
    tasks: rows.map((row) => ({ id: row.id, title: row.title, description: row.description, projectId: row.projectId, tags: row.tags })),
    projects: projects.map((project) => ({ id: project.id, name: project.name, description: project.description })),
  });
  const { data, modelId } = await runAiJson({ system, user, schema: organizeTasksOutputSchema, modelId: request.modelId, signal });
  const result = sanitizeOrganizeTasks(
    data,
    rows.map((row) => ({ id: row.id, title: row.title, projectId: row.projectId, tags: row.tags })),
    projects.map((project) => ({ id: project.id, name: project.name })),
  );
  return { modelId, proposal: { kind: "organize_tasks", reviewed: rows.length, ...result } };
}

async function proposeOrganizeNotes(request: Kind<"organize_notes">, signal?: AbortSignal): Promise<ProposeResponse> {
  const [rows, folders] = await Promise.all([
    prisma.note.findMany({ orderBy: { updatedAt: "desc" }, take: MAX_REVIEW_ITEMS, include: { folder: { select: { name: true } } } }),
    prisma.noteFolder.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (rows.length === 0) throw new ApiError(400, "nothing_to_review", "There are no notes to organize.");

  const { system, user } = organizeNotesPrompt({
    notes: rows.map((row) => ({
      id: row.id,
      title: row.title,
      excerpt: makeExcerpt(row.content, 200),
      folder: row.folder?.name ?? null,
      tags: row.tags,
    })),
    folders: folders.map((folder) => folder.name),
  });
  const { data, modelId } = await runAiJson({ system, user, schema: organizeNotesOutputSchema, modelId: request.modelId, signal });
  const result = sanitizeOrganizeNotes(
    data,
    rows.map((row) => ({ id: row.id, title: row.title, folderId: row.folderId, tags: row.tags })),
    folders.map((folder) => ({ id: folder.id, name: folder.name })),
  );
  return { modelId, proposal: { kind: "organize_notes", reviewed: rows.length, ...result } };
}

export function propose(request: ProposeRequest, signal?: AbortSignal): Promise<ProposeResponse> {
  switch (request.kind) {
    case "project_plan":
      return proposeProjectPlan(request, signal);
    case "note_summary":
      return proposeNoteSummary(request, signal);
    case "task_priorities":
      return proposeTaskPriorities(request, signal);
    case "organize_tasks":
      return proposeOrganizeTasks(request, signal);
    case "organize_notes":
      return proposeOrganizeNotes(request, signal);
  }
}
