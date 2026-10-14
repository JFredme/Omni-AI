import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { dateKeyToDate } from "@/lib/dates";
import { POSITION_STEP } from "@/lib/ordering";
import { normalizeTags } from "@/lib/tags";
import type { ApplyRequest } from "./schemas";
import type { ApplyResponse } from "./types";

type Kind<K extends ApplyRequest["kind"]> = Extract<ApplyRequest, { kind: K }>;

const key = (value: string) => value.trim().toLowerCase();

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Saves a confirmed plan. Tasks whose title already exists in the project are skipped, so applying the
 * same plan twice (a double click, a retry) doesn't create duplicates.
 */
async function applyProjectPlan(request: Kind<"project_plan">): Promise<ApplyResponse> {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: request.projectId },
      include: { milestones: true, tasks: { where: { parentId: null }, select: { title: true } } },
    });
    if (!project) throw new ApiError(404, "not_found", "That project no longer exists.");

    const milestoneIds = new Map(project.milestones.map((milestone) => [key(milestone.title), milestone.id]));
    let milestonesCreated = 0;
    for (const milestone of request.milestones) {
      if (milestoneIds.has(key(milestone.title))) continue;
      const created = await tx.milestone.create({
        data: {
          projectId: project.id,
          title: milestone.title,
          dueDate: milestone.dueDate ? dateKeyToDate(milestone.dueDate) : null,
        },
      });
      milestoneIds.set(key(milestone.title), created.id);
      milestonesCreated += 1;
    }

    const existingTitles = new Set(project.tasks.map((task) => key(task.title)));
    const last = await tx.task.aggregate({ where: { parentId: null, status: "todo" }, _max: { position: true } });
    let position = last._max.position ?? 0;
    let tasksCreated = 0;
    let skipped = 0;

    for (const task of request.tasks) {
      if (existingTitles.has(key(task.title))) {
        skipped += 1;
        continue;
      }
      existingTitles.add(key(task.title));
      position += POSITION_STEP;
      const created = await tx.task.create({
        data: {
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate ? dateKeyToDate(task.dueDate) : null,
          tags: task.tags,
          position,
          projectId: project.id,
          milestoneId: task.milestone ? (milestoneIds.get(key(task.milestone)) ?? null) : null,
        },
      });
      if (task.subtasks.length > 0) {
        await tx.task.createMany({
          data: task.subtasks.map((title, index) => ({ title, parentId: created.id, position: (index + 1) * POSITION_STEP })),
        });
      }
      tasksCreated += 1;
    }

    const parts = [
      tasksCreated ? plural(tasksCreated, "task") : "",
      milestonesCreated ? plural(milestonesCreated, "milestone") : "",
    ].filter(Boolean);
    return {
      applied: tasksCreated + milestonesCreated,
      skipped,
      message: parts.length ? `Added ${parts.join(" and ")}.` : "Nothing was added; those tasks already exist.",
    };
  });
}

async function applyPriorities(request: Kind<"task_priorities">): Promise<ApplyResponse> {
  const results = await prisma.$transaction(
    request.changes.map((change) =>
      prisma.task.updateMany({ where: { id: change.taskId, parentId: null }, data: { priority: change.priority } }),
    ),
  );
  const applied = results.reduce((sum, result) => sum + result.count, 0);
  return { applied, skipped: request.changes.length - applied, message: `Updated ${plural(applied, "task")}.` };
}

async function applyOrganizeTasks(request: Kind<"organize_tasks">): Promise<ApplyResponse> {
  return prisma.$transaction(async (tx) => {
    const projectIds = new Set(
      (await tx.project.findMany({ where: { id: { in: request.changes.map((change) => change.projectId).filter((id): id is string => Boolean(id)) } }, select: { id: true } })).map(
        (project) => project.id,
      ),
    );
    let applied = 0;
    for (const change of request.changes) {
      const task = await tx.task.findFirst({ where: { id: change.taskId, parentId: null }, select: { tags: true, projectId: true } });
      if (!task) continue;
      const moveTo = change.projectId && projectIds.has(change.projectId) && change.projectId !== task.projectId ? change.projectId : null;
      const tags = normalizeTags([...task.tags, ...change.addTags]);
      await tx.task.update({
        where: { id: change.taskId },
        data: { tags, ...(moveTo ? { projectId: moveTo, milestoneId: null } : {}) },
      });
      applied += 1;
    }
    return { applied, skipped: request.changes.length - applied, message: `Organized ${plural(applied, "task")}.` };
  });
}

async function applyOrganizeNotes(request: Kind<"organize_notes">): Promise<ApplyResponse> {
  return prisma.$transaction(async (tx) => {
    const folderIds = new Map((await tx.noteFolder.findMany()).map((folder) => [key(folder.name), folder.id]));
    let applied = 0;
    for (const change of request.changes) {
      const note = await tx.note.findUnique({ where: { id: change.noteId }, select: { tags: true } });
      if (!note) continue;

      let folderId: string | undefined;
      if (change.folder) {
        let id = folderIds.get(key(change.folder));
        if (!id) {
          id = (await tx.noteFolder.create({ data: { name: change.folder } })).id;
          folderIds.set(key(change.folder), id);
        }
        folderId = id;
      }
      await tx.note.update({
        where: { id: change.noteId },
        data: { tags: normalizeTags([...note.tags, ...change.addTags]), ...(folderId ? { folderId } : {}) },
      });
      applied += 1;
    }
    return { applied, skipped: request.changes.length - applied, message: `Organized ${plural(applied, "note")}.` };
  });
}

export function applyProposal(request: ApplyRequest): Promise<ApplyResponse> {
  switch (request.kind) {
    case "project_plan":
      return applyProjectPlan(request);
    case "task_priorities":
      return applyPriorities(request);
    case "organize_tasks":
      return applyOrganizeTasks(request);
    case "organize_notes":
      return applyOrganizeNotes(request);
  }
}
