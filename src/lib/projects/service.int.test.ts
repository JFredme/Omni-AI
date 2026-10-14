// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTask } from "@/lib/tasks/service";
import { updateTask } from "@/lib/tasks/service";
import { assertTestDatabase } from "@/test/db-guard";
import {
  createMilestone,
  createProject,
  deleteMilestone,
  deleteProject,
  getProject,
  listProjects,
  updateMilestone,
  updateProject,
} from "./service";

const TODAY = "2026-06-10";

beforeEach(async () => {
  assertTestDatabase();
  await prisma.task.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.project.deleteMany();
});

describe("project service (database)", () => {
  it("creates projects with defaults and updates them", async () => {
    const project = await createProject({ name: "Launch" });
    expect(project).toMatchObject({ status: "planning", description: "", dueDate: null });
    const updated = await updateProject(project.id, { status: "active", dueDate: "2026-09-01", description: "Ship it" });
    expect(updated).toMatchObject({ status: "active", dueDate: "2026-09-01", description: "Ship it" });
    await expect(updateProject("missing", { name: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(getProject("missing")).rejects.toMatchObject({ status: 404 });
  });

  it("tracks progress from linked top-level tasks only", async () => {
    const project = await createProject({ name: "Site" });
    const a = await createTask({ title: "A", projectId: project.id, dueDate: "2026-06-01" });
    await createTask({ title: "B", projectId: project.id });
    await createTask({ title: "A.1", parentId: a.id });
    await createTask({ title: "Elsewhere" });
    await updateTask(a.id, { status: "done" });

    const detail = await getProject(project.id, TODAY);
    expect(detail.stats).toEqual({ total: 2, todo: 1, inProgress: 0, done: 1, overdue: 0, progress: 50 });

    await createTask({ title: "Late", projectId: project.id, dueDate: "2026-06-02" });
    expect((await getProject(project.id, TODAY)).stats.overdue).toBe(1);
  });

  it("manages milestones and reports their task progress", async () => {
    const project = await createProject({ name: "Site" });
    const milestone = await createMilestone(project.id, { title: "Beta", dueDate: "2026-07-01" });
    const task = await createTask({ title: "Build", milestoneId: milestone.id });
    expect(task.projectId).toBe(project.id);

    let detail = await getProject(project.id, TODAY);
    expect(detail.milestones[0]).toMatchObject({ title: "Beta", taskTotal: 1, taskDone: 0 });

    await updateTask(task.id, { status: "done" });
    const done = await updateMilestone(milestone.id, { completed: true });
    expect(done.completedAt).not.toBeNull();
    expect(done.taskDone).toBe(1);

    detail = await getProject(project.id, TODAY);
    expect(detail.milestoneDone).toBe(1);

    expect((await updateMilestone(milestone.id, { completed: false })).completedAt).toBeNull();
    await expect(createMilestone("missing", { title: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(updateMilestone("missing", { title: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("deleting a milestone keeps its tasks in the project", async () => {
    const project = await createProject({ name: "Site" });
    const milestone = await createMilestone(project.id, { title: "Beta" });
    const task = await createTask({ title: "Build", milestoneId: milestone.id });
    await deleteMilestone(milestone.id);
    await expect(deleteMilestone(milestone.id)).rejects.toMatchObject({ status: 404 });
    const remaining = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(remaining).toMatchObject({ projectId: project.id, milestoneId: null });
  });

  it("deleting a project keeps its tasks and removes its milestones", async () => {
    const project = await createProject({ name: "Temp" });
    await createMilestone(project.id, { title: "M" });
    const task = await createTask({ title: "Keep", projectId: project.id });
    await deleteProject(project.id);
    expect(await prisma.milestone.count()).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).projectId).toBeNull();
    await expect(deleteProject(project.id)).rejects.toMatchObject({ status: 404 });
  });

  it("hides archived projects unless asked", async () => {
    await createProject({ name: "Live", status: "active" });
    await createProject({ name: "Old", status: "archived" });
    expect((await listProjects({}, TODAY)).map((p) => p.name)).toEqual(["Live"]);
    expect((await listProjects({ includeArchived: true }, TODAY)).map((p) => p.name).sort()).toEqual(["Live", "Old"]);
  });
});
