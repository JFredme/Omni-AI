// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { createTask, deleteTask, getTask, listTaskTags, listTasks, updateTask } from "./service";

const TODAY = "2026-06-10";

beforeEach(async () => {
  assertTestDatabase();
  await prisma.task.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.project.deleteMany();
});

describe("task service (database)", () => {
  it("creates tasks with defaults and appends them to the end of their column", async () => {
    const first = await createTask({ title: "First" });
    const second = await createTask({ title: "Second" });
    expect(first.status).toBe("todo");
    expect(first.priority).toBe("medium");
    expect(second.position).toBeGreaterThan(first.position);
    expect((await listTasks({}, TODAY)).map((task) => task.title)).toEqual(["First", "Second"]);
  });

  it("sets and clears completedAt as the status changes", async () => {
    const task = await createTask({ title: "Ship" });
    const done = await updateTask(task.id, { status: "done" });
    expect(done.completedAt).not.toBeNull();
    const reopened = await updateTask(task.id, { status: "in_progress" });
    expect(reopened.completedAt).toBeNull();
  });

  it("nests subtasks one level deep and lists them under the parent", async () => {
    const parent = await createTask({ title: "Parent" });
    const child = await createTask({ title: "Child", parentId: parent.id });
    await expect(createTask({ title: "Grandchild", parentId: child.id })).rejects.toMatchObject({ code: "nested_subtask" });

    const listed = await listTasks({}, TODAY);
    expect(listed).toHaveLength(1);
    expect(listed[0].subtasks.map((subtask) => subtask.title)).toEqual(["Child"]);

    await deleteTask(parent.id);
    expect(await prisma.task.count()).toBe(0);
  });

  it("filters by status, priority, tag, search text, and due date", async () => {
    await createTask({ title: "Pay rent", priority: "urgent", dueDate: "2026-06-09", tags: ["home"] });
    await createTask({ title: "Plan trip", priority: "low", dueDate: "2026-06-10", description: "Book flights" });
    await createTask({ title: "Read book", status: "done", dueDate: "2026-06-01" });
    await createTask({ title: "Someday" });

    const titles = async (filters: Parameters<typeof listTasks>[0]) => (await listTasks(filters, TODAY)).map((task) => task.title).sort();
    expect(await titles({ status: "done" })).toEqual(["Read book"]);
    expect(await titles({ priority: "urgent" })).toEqual(["Pay rent"]);
    expect(await titles({ tag: "home" })).toEqual(["Pay rent"]);
    expect(await titles({ q: "flights" })).toEqual(["Plan trip"]);
    expect(await titles({ q: "RENT" })).toEqual(["Pay rent"]);
    expect(await titles({ due: "overdue" })).toEqual(["Pay rent"]);
    expect(await titles({ due: "today" })).toEqual(["Plan trip"]);
    expect(await titles({ due: "none" })).toEqual(["Someday"]);
  });

  it("treats % and _ in a search as plain characters, not wildcards", async () => {
    await createTask({ title: "Save 100% of the budget" });
    await createTask({ title: "snake_case rename" });
    await createTask({ title: "Plain task" });
    const titles = async (q: string) => (await listTasks({ q }, TODAY)).map((task) => task.title);
    expect(await titles("%")).toEqual(["Save 100% of the budget"]);
    expect(await titles("_")).toEqual(["snake_case rename"]);
  });

  it("matches a search on a subtask title and returns the parent", async () => {
    const parent = await createTask({ title: "Launch" });
    await createTask({ title: "Write press release", parentId: parent.id });
    expect((await listTasks({ q: "press" }, TODAY)).map((task) => task.title)).toEqual(["Launch"]);
  });

  it("sorts by priority and by due date with undated tasks last", async () => {
    await createTask({ title: "Low", priority: "low", dueDate: "2026-06-01" });
    await createTask({ title: "Urgent", priority: "urgent" });
    await createTask({ title: "High", priority: "high", dueDate: "2026-07-01" });
    expect((await listTasks({ sort: "priority" }, TODAY)).map((task) => task.title)).toEqual(["Urgent", "High", "Low"]);
    expect((await listTasks({ sort: "due" }, TODAY)).map((task) => task.title)).toEqual(["Low", "High", "Urgent"]);
  });

  it("links tasks to projects and milestones, and rejects mismatches", async () => {
    const alpha = await prisma.project.create({ data: { name: "Alpha" } });
    const beta = await prisma.project.create({ data: { name: "Beta" } });
    const milestone = await prisma.milestone.create({ data: { projectId: alpha.id, title: "M1" } });

    const task = await createTask({ title: "Linked", milestoneId: milestone.id });
    expect(task.projectId).toBe(alpha.id);
    expect(task.milestoneTitle).toBe("M1");

    await expect(updateTask(task.id, { projectId: beta.id, milestoneId: milestone.id })).rejects.toMatchObject({
      code: "milestone_project_mismatch",
    });
    const moved = await updateTask(task.id, { projectId: beta.id });
    expect(moved.projectId).toBe(beta.id);
    expect(moved.milestoneId).toBeNull();

    await expect(createTask({ title: "Ghost", projectId: "missing" })).rejects.toMatchObject({ code: "project_not_found" });
  });

  it("keeps tasks when their project is deleted", async () => {
    const project = await prisma.project.create({ data: { name: "Temp" } });
    const task = await createTask({ title: "Survivor", projectId: project.id });
    await prisma.project.delete({ where: { id: project.id } });
    expect((await getTask(task.id)).projectId).toBeNull();
  });

  it("reports 404 for missing tasks and counts tags", async () => {
    await expect(getTask("nope")).rejects.toMatchObject({ status: 404 });
    await expect(deleteTask("nope")).rejects.toMatchObject({ status: 404 });
    await createTask({ title: "a", tags: ["x", "y"] });
    await createTask({ title: "b", tags: ["x"] });
    expect(await listTaskTags()).toEqual([
      { tag: "x", count: 2 },
      { tag: "y", count: 1 },
    ]);
  });
});
