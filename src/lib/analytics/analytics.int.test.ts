// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { getAnalytics } from "./service";

const NOW = new Date("2026-05-20T15:00:00Z");
const at = (iso: string) => new Date(iso);
const day = (analytics: { date: string; value: number }[], date: string) => analytics.find((p) => p.date === date)?.value;

beforeEach(async () => {
  assertTestDatabase();
  await prisma.calendarEvent.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.usageRecord.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.note.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.appSettings.deleteMany();
});

describe("analytics (database)", () => {
  it("is all zeros, with nothing made up, when there's no data", async () => {
    const a = await getAnalytics({ days: 7, timeZone: "UTC", now: NOW });
    expect(a.tasks.totals).toEqual({ created: 0, completed: 0, open: 0, overdue: 0 });
    expect(a.tasks.medianDaysToComplete).toBeNull();
    expect(a.tasks.completedPerCreated).toBeNull();
    expect(a.tasks.created).toHaveLength(7);
    expect(a.tasks.created.every((p) => p.value === 0)).toBe(true);
    expect(a.from).toBe("2026-05-14");
    expect(a.to).toBe("2026-05-20");
    expect(a.ai.totals.requests).toBe(0);
    expect(a.time.totalFocusHours).toBe(0);
  });

  it("counts tasks created and finished per day, the median time to finish, and what's open or overdue", async () => {
    const project = await prisma.project.create({ data: { name: "Site" } });
    await prisma.task.createMany({
      data: [
        { title: "a", createdAt: at("2026-05-18T10:00:00Z"), completedAt: at("2026-05-19T10:00:00Z"), status: "done", priority: "high", projectId: project.id },
        { title: "b", createdAt: at("2026-05-16T10:00:00Z"), completedAt: at("2026-05-19T22:00:00Z"), status: "done", priority: "low", projectId: project.id },
        { title: "c", createdAt: at("2026-05-19T09:00:00Z"), status: "todo", priority: "urgent", dueDate: new Date("2026-05-10") },
        { title: "d", createdAt: at("2026-04-01T09:00:00Z"), status: "in_progress", priority: "medium", projectId: project.id },
        { title: "old and done", createdAt: at("2026-01-01T09:00:00Z"), completedAt: at("2026-01-02T09:00:00Z"), status: "done", priority: "low" },
      ],
    });
    const parent = await prisma.task.findFirstOrThrow({ where: { title: "c" } });
    await prisma.task.create({ data: { title: "subtask", parentId: parent.id, createdAt: at("2026-05-19T09:00:00Z") } });

    const a = await getAnalytics({ days: 7, timeZone: "UTC", now: NOW });
    expect(a.tasks.totals).toEqual({ created: 3, completed: 2, open: 2, overdue: 1 });
    expect(day(a.tasks.completed, "2026-05-19")).toBe(2);
    expect(day(a.tasks.created, "2026-05-18")).toBe(1);
    expect(a.tasks.medianDaysToComplete).toBe(2.3); // median of 1 and 3.5 days is 2.25, shown to one decimal
    expect(a.tasks.completedPerCreated).toBe(67);
    expect(a.tasks.byPriority.find((p) => p.priority === "urgent")).toEqual({ priority: "urgent", open: 1, completed: 0 });
    expect(a.tasks.byPriority.find((p) => p.priority === "high")).toEqual({ priority: "high", open: 0, completed: 1 });
    expect(a.tasks.byProject).toEqual([{ name: "Site", open: 1, completed: 2 }]);
    // A wider window sees the older work; a narrower one doesn't.
    expect((await getAnalytics({ days: 90, timeZone: "UTC", now: NOW })).tasks.totals.completed).toBe(2);
    expect((await getAnalytics({ days: 1, timeZone: "UTC", now: NOW })).tasks.totals.completed).toBe(0);
  });

  it("uses the viewer's time zone to decide which day something happened on", async () => {
    await prisma.task.create({ data: { title: "late night", createdAt: at("2026-05-19T03:30:00Z") } });
    const utc = await getAnalytics({ days: 3, timeZone: "UTC", now: NOW });
    const la = await getAnalytics({ days: 3, timeZone: "America/Los_Angeles", now: NOW });
    expect(day(utc.tasks.created, "2026-05-19")).toBe(1);
    expect(day(la.tasks.created, "2026-05-18")).toBe(1);
    expect(day(la.tasks.created, "2026-05-19")).toBe(0);
  });

  it("separates time set aside for tasks from all scheduled time, including repeating events", async () => {
    const task = await prisma.task.create({ data: { title: "Write" } });
    await prisma.calendarEvent.create({ data: { title: "Work on: Write", startsAt: at("2026-05-19T09:00:00Z"), endsAt: at("2026-05-19T11:00:00Z"), taskId: task.id } });
    await prisma.calendarEvent.create({ data: { title: "Meeting", startsAt: at("2026-05-19T13:00:00Z"), endsAt: at("2026-05-19T14:30:00Z") } });
    await prisma.calendarEvent.create({ data: { title: "Holiday", startsAt: at("2026-05-19T00:00:00Z"), endsAt: at("2026-05-20T00:00:00Z"), allDay: true } });
    await prisma.calendarEvent.create({ data: { title: "Standup", startsAt: at("2026-05-15T08:00:00Z"), endsAt: at("2026-05-15T08:30:00Z"), recurrence: { freq: "daily", interval: 1, count: 3 } } });
    const a = await getAnalytics({ days: 7, timeZone: "UTC", now: NOW });
    expect(day(a.time.focusHoursByDay, "2026-05-19")).toBe(2);
    expect(day(a.time.scheduledHoursByDay, "2026-05-19")).toBe(3.5);
    expect(a.time.totalFocusHours).toBe(2);
    expect(a.time.totalScheduledHours).toBe(5); // 2 + 1.5 + three half-hour standups; all-day events don't count as hours
  });

  it("totals AI spend by day and model, and reports the month against the limit", async () => {
    await prisma.appSettings.create({ data: { id: 1, monthlyBudgetUsd: 5 } });
    await prisma.usageRecord.createMany({
      data: [
        { modelId: "a/x", costUsd: 0.5, totalTokens: 1000, status: "complete", createdAt: at("2026-05-19T10:00:00Z") },
        { modelId: "a/x", costUsd: 0.25, totalTokens: 500, status: "complete", createdAt: at("2026-05-19T12:00:00Z") },
        { modelId: "b/y", costUsd: 0.1, totalTokens: 200, status: "complete", createdAt: at("2026-05-20T10:00:00Z") },
        { modelId: "b/y", status: "error", createdAt: at("2026-05-20T11:00:00Z") },
        { modelId: "c/old", costUsd: 9, totalTokens: 9, status: "complete", createdAt: at("2026-01-05T10:00:00Z") },
      ],
    });
    const a = await getAnalytics({ days: 7, timeZone: "UTC", now: NOW });
    expect(a.ai.totals).toMatchObject({ requests: 4, failedRequests: 1, totalTokens: 1700 });
    expect(a.ai.totals.costUsd).toBeCloseTo(0.85);
    expect(day(a.ai.spendByDay, "2026-05-19")).toBeCloseTo(0.75);
    expect(a.ai.byModel.map((m) => m.modelId)).toEqual(["a/x", "b/y"]);
    expect(a.ai.month.budgetUsd).toBe(5);
  });

  it("counts activity across the app", async () => {
    const conversation = await prisma.conversation.create({ data: { createdAt: at("2026-05-19T10:00:00Z") } });
    await prisma.message.createMany({ data: [{ conversationId: conversation.id, role: "user", content: "hi", createdAt: at("2026-05-19T10:00:00Z") }, { conversationId: conversation.id, role: "assistant", content: "hello", createdAt: at("2026-05-19T10:00:01Z") }] });
    await prisma.note.create({ data: { title: "n", createdAt: at("2026-05-19T10:00:00Z") } });
    const agent = await prisma.agent.create({ data: { name: "A", builtInKey: null } });
    await prisma.agentRun.createMany({ data: [{ agentId: agent.id, objective: "o", budgetUsd: 1, status: "completed", createdAt: at("2026-05-19T10:00:00Z") }, { agentId: agent.id, objective: "o2", budgetUsd: 1, status: "failed", createdAt: at("2026-05-19T10:00:00Z") }] });
    const flow = await prisma.workflow.create({ data: { name: "w", trigger: { type: "manual" }, steps: [] } });
    await prisma.workflowRun.create({ data: { workflowId: flow.id, triggerType: "manual", status: "succeeded", startedAt: at("2026-05-19T10:00:00Z") } });
    const a = await getAnalytics({ days: 7, timeZone: "UTC", now: NOW });
    expect(a.activity).toMatchObject({ conversations: 1, messagesSent: 1, notesCreated: 1, agentRuns: { completed: 1, failed: 1 }, automationRuns: { succeeded: 1 } });
  });
});
