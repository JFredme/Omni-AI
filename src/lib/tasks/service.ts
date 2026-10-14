import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { addDays, dateKeyToDate, dateToDateKey, localDateKey } from "@/lib/dates";
import { POSITION_STEP } from "@/lib/ordering";
import type { Prisma } from "@/generated/prisma/client";
import type { CreateTaskInput, UpdateTaskInput } from "./schemas";
import type { TaskDto, TaskFilters, TaskSort } from "./types";

const taskInclude = {
  project: { select: { name: true } },
  milestone: { select: { title: true } },
  subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: { project: { select: { name: true } }; milestone: { select: { title: true } } } }> & {
  subtasks?: Prisma.TaskGetPayload<object>[];
};

export function serializeTask(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: dateToDateKey(row.dueDate),
    completedAt: row.completedAt?.toISOString() ?? null,
    tags: row.tags,
    position: row.position,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    milestoneId: row.milestoneId,
    milestoneTitle: row.milestone?.title ?? null,
    parentId: row.parentId,
    subtasks: (row.subtasks ?? []).map((subtask) => serializeTask({ ...subtask, project: null, milestone: null })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function orderByFor(sort: TaskSort): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case "due":
      return [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "desc" }];
    case "priority":
      return [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
    case "created":
      return [{ createdAt: "desc" }];
    case "updated":
      return [{ updatedAt: "desc" }];
    case "title":
      return [{ title: "asc" }];
    default:
      return [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }];
  }
}

export function buildTaskWhere(filters: TaskFilters, today: string): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [{ parentId: null }];
  if (filters.status) and.push({ status: filters.status });
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.projectId) and.push({ projectId: filters.projectId === "none" ? null : filters.projectId });
  if (filters.tag) and.push({ tags: { has: filters.tag.toLowerCase() } });
  if (filters.q) {
    const q = filters.q;
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase().replace(/^#/, "") } },
        { subtasks: { some: { title: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  switch (filters.due) {
    case "overdue":
      and.push({ dueDate: { lt: dateKeyToDate(today) }, status: { not: "done" } });
      break;
    case "today":
      and.push({ dueDate: dateKeyToDate(today) });
      break;
    case "week":
      and.push({ dueDate: { gte: dateKeyToDate(today), lte: dateKeyToDate(addDays(today, 7)) } });
      break;
    case "none":
      and.push({ dueDate: null });
      break;
    default:
      break;
  }
  return { AND: and };
}

export async function listTasks(filters: TaskFilters = {}, today: string = localDateKey()): Promise<TaskDto[]> {
  const rows = await prisma.task.findMany({
    where: buildTaskWhere(filters, today),
    orderBy: orderByFor(filters.sort ?? "manual"),
    include: taskInclude,
    take: 1000,
  });
  return rows.map(serializeTask);
}

export async function getTask(id: string): Promise<TaskDto> {
  const row = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!row) throw new ApiError(404, "not_found", "That task no longer exists.");
  return serializeTask(row);
}

async function nextPosition(status: string, parentId: string | null): Promise<number> {
  const last = await prisma.task.aggregate({
    where: { parentId, ...(parentId ? {} : { status: status as "todo" | "in_progress" | "done" }) },
    _max: { position: true },
  });
  return (last._max.position ?? 0) + POSITION_STEP;
}

/**
 * Resolves the project/milestone pair for a top-level task. A milestone belongs to one project, so choosing
 * a milestone fixes the project; choosing a different project drops a milestone that belongs elsewhere.
 */
async function resolveLinks(
  projectId: string | null | undefined,
  milestoneId: string | null | undefined,
  current?: { projectId: string | null; milestoneId: string | null },
): Promise<{ projectId: string | null; milestoneId: string | null }> {
  let nextProject = projectId === undefined ? (current?.projectId ?? null) : projectId;
  let nextMilestone = milestoneId === undefined ? (current?.milestoneId ?? null) : milestoneId;

  if (nextMilestone) {
    const milestone = await prisma.milestone.findUnique({ where: { id: nextMilestone }, select: { projectId: true } });
    if (!milestone) throw new ApiError(400, "milestone_not_found", "That milestone no longer exists.");
    if (nextProject && nextProject !== milestone.projectId) {
      if (milestoneId !== undefined && milestoneId !== null) {
        throw new ApiError(400, "milestone_project_mismatch", "That milestone belongs to a different project.");
      }
      nextMilestone = null;
    } else {
      nextProject = milestone.projectId;
    }
  }
  if (nextProject) {
    const project = await prisma.project.findUnique({ where: { id: nextProject }, select: { id: true } });
    if (!project) throw new ApiError(400, "project_not_found", "That project no longer exists.");
  }
  return { projectId: nextProject, milestoneId: nextMilestone };
}

export async function createTask(input: CreateTaskInput): Promise<TaskDto> {
  const status = input.status ?? "todo";

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await prisma.task.findUnique({ where: { id: input.parentId }, select: { id: true, parentId: true } });
    if (!parent) throw new ApiError(404, "not_found", "The parent task no longer exists.");
    if (parent.parentId) throw new ApiError(400, "nested_subtask", "Subtasks can't have their own subtasks.");
    parentId = parent.id;
  }

  const links = parentId ? { projectId: null, milestoneId: null } : await resolveLinks(input.projectId, input.milestoneId);

  const row = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description ?? "",
      status,
      priority: input.priority ?? "medium",
      dueDate: input.dueDate ? dateKeyToDate(input.dueDate) : null,
      completedAt: status === "done" ? new Date() : null,
      tags: input.tags ?? [],
      position: await nextPosition(status, parentId),
      parentId,
      ...links,
    },
    include: taskInclude,
  });
  return serializeTask(row);
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<TaskDto> {
  const existing = await prisma.task.findUnique({ where: { id }, select: { status: true, parentId: true, projectId: true, milestoneId: true } });
  if (!existing) throw new ApiError(404, "not_found", "That task no longer exists.");

  const touchesLinks = patch.projectId !== undefined || patch.milestoneId !== undefined;
  if (existing.parentId && touchesLinks && (patch.projectId || patch.milestoneId)) {
    throw new ApiError(400, "subtask_link", "Subtasks follow their parent's project. Change the parent instead.");
  }
  const links = !existing.parentId && touchesLinks ? await resolveLinks(patch.projectId, patch.milestoneId, existing) : null;

  const row = await prisma.task.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? dateKeyToDate(patch.dueDate) : null } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      ...(patch.status !== undefined
        ? {
            status: patch.status,
            ...(patch.status !== existing.status ? { completedAt: patch.status === "done" ? new Date() : null } : {}),
          }
        : {}),
      ...(links ?? {}),
    },
    include: taskInclude,
  });
  return serializeTask(row);
}

export async function deleteTask(id: string): Promise<void> {
  const result = await prisma.task.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That task no longer exists.");
}

/** Every tag in use, with counts, for filter menus. */
export async function listTaskTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await prisma.task.findMany({ where: { parentId: null, NOT: { tags: { isEmpty: true } } }, select: { tags: true } });
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
