import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { dateKeyToDate, dateToDateKey, localDateKey } from "@/lib/dates";
import type { Prisma } from "@/generated/prisma/client";
import { computeStats, sortMilestones } from "./logic";
import type { MilestoneDto, ProjectDetailDto, ProjectDto, ProjectStatus } from "./types";

type ProjectRow = Prisma.ProjectGetPayload<{ include: { milestones: true } }>;
type TaskStatRow = { projectId: string | null; milestoneId: string | null; status: "todo" | "in_progress" | "done"; dueDate: Date | null };

function serializeProject(row: ProjectRow, tasks: TaskStatRow[], today: string): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    dueDate: dateToDateKey(row.dueDate),
    stats: computeStats(
      tasks.map((task) => ({ status: task.status, dueDate: dateToDateKey(task.dueDate) })),
      today,
    ),
    milestoneTotal: row.milestones.length,
    milestoneDone: row.milestones.filter((milestone) => milestone.completedAt).length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMilestone(row: Prisma.MilestoneGetPayload<object>, tasks: TaskStatRow[]): MilestoneDto {
  const linked = tasks.filter((task) => task.milestoneId === row.id);
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    dueDate: dateToDateKey(row.dueDate),
    completedAt: row.completedAt?.toISOString() ?? null,
    taskTotal: linked.length,
    taskDone: linked.filter((task) => task.status === "done").length,
    createdAt: row.createdAt.toISOString(),
  };
}

function loadTaskStats(projectIds: string[]): Promise<TaskStatRow[]> {
  return prisma.task.findMany({
    where: { projectId: { in: projectIds }, parentId: null },
    select: { projectId: true, milestoneId: true, status: true, dueDate: true },
  });
}

export async function listProjects(options: { includeArchived?: boolean; status?: ProjectStatus } = {}, today = localDateKey()): Promise<ProjectDto[]> {
  const rows = await prisma.project.findMany({
    where: options.status ? { status: options.status } : options.includeArchived ? {} : { status: { not: "archived" } },
    orderBy: [{ updatedAt: "desc" }],
    include: { milestones: true },
  });
  const tasks = await loadTaskStats(rows.map((row) => row.id));
  return rows.map((row) =>
    serializeProject(
      row,
      tasks.filter((task) => task.projectId === row.id),
      today,
    ),
  );
}

export async function getProject(id: string, today = localDateKey()): Promise<ProjectDetailDto> {
  const row = await prisma.project.findUnique({ where: { id }, include: { milestones: true } });
  if (!row) throw new ApiError(404, "not_found", "That project no longer exists.");
  const tasks = await loadTaskStats([id]);
  const milestones = sortMilestones(row.milestones.map((milestone) => serializeMilestone(milestone, tasks)));
  return { ...serializeProject(row, tasks, today), milestones };
}

export async function createProject(input: { name: string; description?: string; status?: ProjectStatus; dueDate?: string | null }) {
  const row = await prisma.project.create({
    data: {
      name: input.name,
      description: input.description ?? "",
      status: input.status ?? "planning",
      dueDate: input.dueDate ? dateKeyToDate(input.dueDate) : null,
    },
  });
  return getProject(row.id);
}

export async function updateProject(
  id: string,
  patch: { name?: string; description?: string; status?: ProjectStatus; dueDate?: string | null },
) {
  try {
    await prisma.project.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? dateKeyToDate(patch.dueDate) : null } : {}),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") throw new ApiError(404, "not_found", "That project no longer exists.");
    throw error;
  }
  return getProject(id);
}

/** Deleting a project keeps its tasks; they become unassigned. Milestones are deleted with it. */
export async function deleteProject(id: string): Promise<void> {
  const result = await prisma.project.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That project no longer exists.");
}

async function milestoneDto(id: string): Promise<MilestoneDto> {
  const row = await prisma.milestone.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "That milestone no longer exists.");
  return serializeMilestone(row, await loadTaskStats([row.projectId]));
}

export async function createMilestone(projectId: string, input: { title: string; dueDate?: string | null }): Promise<MilestoneDto> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new ApiError(404, "not_found", "That project no longer exists.");
  const row = await prisma.milestone.create({
    data: { projectId, title: input.title, dueDate: input.dueDate ? dateKeyToDate(input.dueDate) : null },
  });
  return milestoneDto(row.id);
}

export async function updateMilestone(
  id: string,
  patch: { title?: string; dueDate?: string | null; completed?: boolean },
): Promise<MilestoneDto> {
  const existing = await prisma.milestone.findUnique({ where: { id }, select: { completedAt: true } });
  if (!existing) throw new ApiError(404, "not_found", "That milestone no longer exists.");
  await prisma.milestone.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? dateKeyToDate(patch.dueDate) : null } : {}),
      ...(patch.completed !== undefined ? { completedAt: patch.completed ? (existing.completedAt ?? new Date()) : null } : {}),
    },
  });
  return milestoneDto(id);
}

/** Tasks linked to a deleted milestone stay in the project, just without a milestone. */
export async function deleteMilestone(id: string): Promise<void> {
  const result = await prisma.milestone.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That milestone no longer exists.");
}
