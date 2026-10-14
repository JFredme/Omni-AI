// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { clearCatalogCache } from "@/lib/openrouter/catalog";
import { saveApiKey, updateSettings } from "@/lib/settings";
import { createTask, listTasks, updateTask } from "@/lib/tasks/service";
import { assertTestDatabase } from "@/test/db-guard";
import { automationsIdle, MAX_RUNS_PER_HOUR, recoverInterruptedRuns, runWorkflow, tick } from "./engine";
import { createWorkflowSchema, updateWorkflowSchema } from "./schemas";
import { createWorkflow, findByWebhookToken, getRun, listRuns, rotateWebhookToken, updateWorkflow } from "./service";

const fetchMock = vi.fn<typeof fetch>();
let aiReply = "A friendly briefing.";
const external: { url: string; init?: RequestInit }[] = [];
let externalHandler: (url: string, init?: RequestInit) => Response = () => new Response("ok", { status: 200 });

function sse(text: string): Response {
  const encoder = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(encoder.encode(chunk)); c.close(); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const wf = (over: Record<string, unknown> = {}) =>
  createWorkflow(createWorkflowSchema.parse({ name: "Test", trigger: { type: "manual" }, steps: [], ...over }));
const step = (s: Record<string, unknown>) => ({ id: `s${Math.random().toString(36).slice(2, 8)}`, ...s });
const note = (title: string, content: string) => step({ type: "create_note", title, content });
const manual = (id: string, data: Record<string, unknown> = {}) => runWorkflow(id, { type: "manual", data });

beforeEach(async () => {
  assertTestDatabase();
  await automationsIdle();
  await prisma.workflow.deleteMany();
  await prisma.task.deleteMany();
  await prisma.note.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.usageRecord.deleteMany();
  await prisma.appSettings.deleteMany();
  clearCatalogCache();
  aiReply = "A friendly briefing.";
  external.length = 0;
  externalHandler = () => new Response("ok", { status: 200 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("openrouter.test")) return sse(aiReply);
    external.push({ url, init });
    return externalHandler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  await saveApiKey("sk-or-v1-integration-test-key-1234");
  await updateSettings({ defaultModelId: "acme/chat", monthlyBudgetUsd: null });
});

afterEach(async () => {
  await automationsIdle();
});

describe("running automations (database)", () => {
  it("runs steps in order, passing each result to the next, and records everything", async () => {
    await createTask({ title: "Pay rent", priority: "high", dueDate: new Date().toISOString().slice(0, 10) });
    const { id } = await wf({
      steps: [step({ type: "fetch_tasks", filter: "due_today" }), step({ type: "ai_prompt", prompt: "Summarize:\n{{steps.1.output}}", system: "" }), note("Briefing {{today}}", "{{steps.2.output}}")],
    });
    const outcome = await manual(id);
    expect(outcome.status).toBe("succeeded");

    const run = await getRun(outcome.runId);
    expect(run.steps.map((s) => [s.type, s.status])).toEqual([["fetch_tasks", "ok"], ["ai_prompt", "ok"], ["create_note", "ok"]]);
    expect(String(run.steps[0].output)).toContain("Pay rent");
    expect(JSON.stringify(run.steps[1].input)).toContain("Pay rent");
    expect(run.steps[1].output).toBe("A friendly briefing.");
    const saved = await prisma.note.findFirstOrThrow();
    expect(saved.content).toBe("A friendly briefing.");
    expect(saved.title).toMatch(/^Briefing \d{4}-\d{2}-\d{2}$/);
    // The AI call is billed and recorded like any other.
    expect(await prisma.usageRecord.count({ where: { status: "complete" } })).toBe(1);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id } })).lastRunAt).not.toBeNull();
  });

  it("fills placeholders from the trigger", async () => {
    const { id } = await wf({ steps: [step({ type: "create_task", title: "Follow up: {{trigger.title}}", description: "", priority: "high", dueInDays: 2, tags: "auto, follow-up" })] });
    await manual(id, { title: "Call the plumber" });
    const [task] = await listTasks({});
    expect(task).toMatchObject({ title: "Follow up: Call the plumber", priority: "high", tags: ["auto", "follow-up"] });
    expect(task.dueDate).not.toBeNull();
  });

  it("stops quietly when a condition isn't met, and marks the rest skipped", async () => {
    const { id } = await wf({
      steps: [step({ type: "condition", value: "{{trigger.title}}", operator: "contains", compare: "urgent" }), note("Should not exist", "x")],
    });
    const skipped = await manual(id, { title: "routine thing" });
    expect(skipped.status).toBe("skipped");
    expect(await prisma.note.count()).toBe(0);
    expect((await getRun(skipped.runId)).steps.map((s) => s.status)).toEqual(["ok", "skipped"]);

    const passed = await manual(id, { title: "URGENT: server down" });
    expect(passed.status).toBe("succeeded");
    expect(await prisma.note.count()).toBe(1);
  });

  it("stops at the first failing step, says why in plain words, and skips what's left", async () => {
    const { id } = await wf({
      steps: [step({ type: "create_task", title: "{{trigger.missing}}", description: "", priority: "medium", dueInDays: null, tags: "" }), note("never", "x")],
    });
    const outcome = await manual(id);
    expect(outcome.status).toBe("failed");
    const run = await getRun(outcome.runId);
    expect(run.error).toBe("Step 1 failed: The task's title was empty after filling in the placeholders.");
    expect(run.steps.map((s) => s.status)).toEqual(["error", "skipped"]);
    expect(await prisma.note.count()).toBe(0);
  });

  it("explains an AI failure instead of a stack trace", async () => {
    fetchMock.mockImplementation(async (input) => (String(input).includes("openrouter.test") ? Response.json({ error: { code: 401, message: "bad key" } }, { status: 401 }) : new Response("ok")));
    const { id } = await wf({ steps: [step({ type: "ai_prompt", prompt: "hi", system: "" })] });
    const run = await getRun((await manual(id)).runId);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/^Step 1 failed: /);
    expect(run.error).not.toMatch(/at \w+ \(/);
  });

  it("adds calendar events at a chosen time", async () => {
    const { id } = await wf({ steps: [step({ type: "create_event", title: "Review {{trigger.name}}", day: "tomorrow", time: "15:30", durationMinutes: 45, timezone: "UTC" })] });
    await manual(id, { name: "Q3" });
    const event = await prisma.calendarEvent.findFirstOrThrow();
    expect(event.title).toBe("Review Q3");
    expect(event.startsAt.toISOString().slice(11, 16)).toBe("15:30");
    expect(event.endsAt.getTime() - event.startsAt.getTime()).toBe(45 * 60_000);
  });
});

describe("calling web addresses (database)", () => {
  const http = (over: Record<string, unknown> = {}) =>
    step({ type: "http_request", method: "POST", url: "https://8.8.8.8/hook?q={{trigger.q}}", headers: [{ name: "Authorization", value: "Bearer s3cret-token" }], body: '{"title":"{{trigger.title}}"}', failOnError: true, ...over });

  it("sends the filled-in request, keeps the secret out of the run history, and records the answer", async () => {
    externalHandler = () => new Response('{"id":42}', { status: 201 });
    const { id } = await wf({ steps: [http()] });
    const outcome = await manual(id, { title: "Hello", q: "x" });
    expect(outcome.status).toBe("succeeded");
    expect(external).toHaveLength(1);
    expect(external[0].url).toBe("https://8.8.8.8/hook?q=x");
    expect(external[0].init?.method).toBe("POST");
    expect(new Headers(external[0].init?.headers).get("authorization")).toBe("Bearer s3cret-token");
    expect(external[0].init?.body).toBe('{"title":"Hello"}');
    const run = await getRun(outcome.runId);
    expect(run.steps[0].output).toMatchObject({ status: 201, ok: true, body: '{"id":42}' });
    expect(JSON.stringify(run)).not.toContain("s3cret-token");
  });

  it("blocks addresses on this machine or network, before sending anything", async () => {
    for (const url of ["http://localhost:3000/api/tasks", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://192.168.1.10/admin", "file:///etc/passwd"]) {
      const { id } = await wf({ steps: [http({ url })] });
      const run = await getRun((await manual(id)).runId);
      expect(run.status, url).toBe("failed");
      expect(run.error, url).toMatch(/blocked|http and https/);
    }
    expect(external).toHaveLength(0);
  });

  it("re-checks every redirect, so a public address can't bounce to a private one", async () => {
    externalHandler = () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
    const { id } = await wf({ steps: [http()] });
    const run = await getRun((await manual(id)).runId);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/redirect pointed somewhere that is blocked/);
    expect(external).toHaveLength(1);
  });

  it("fails on an error status unless told not to", async () => {
    externalHandler = () => new Response("nope", { status: 500 });
    const failing = await wf({ steps: [http()] });
    const run = await getRun((await manual(failing.id)).runId);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/HTTP 500/);
    expect(run.steps[0].output).toMatchObject({ status: 500 });
    const lenient = await wf({ steps: [http({ failOnError: false })] });
    expect((await manual(lenient.id)).status).toBe("succeeded");
  });
});

describe("triggers (database)", () => {
  it("runs automations when tasks are created or completed, only when they're switched on", async () => {
    const created = await wf({ name: "On create", trigger: { type: "task_created" }, steps: [note("Created: {{trigger.title}}", "")] });
    const completed = await wf({ name: "On done", trigger: { type: "task_completed" }, steps: [note("Done: {{trigger.title}}", "")] });
    const off = await wf({ name: "Off", trigger: { type: "task_created" }, steps: [note("Should not run", "")] });

    await createTask({ title: "before enabling" });
    await automationsIdle();
    expect(await prisma.note.count()).toBe(0);

    await updateWorkflow(created.id, updateWorkflowSchema.parse({ enabled: true }));
    await updateWorkflow(completed.id, updateWorkflowSchema.parse({ enabled: true }));
    const task = await createTask({ title: "Pay rent" });
    await automationsIdle();
    expect((await prisma.note.findMany()).map((n) => n.title)).toEqual(["Created: Pay rent"]);

    await updateTask(task.id, { status: "done" });
    await automationsIdle();
    expect((await prisma.note.findMany({ orderBy: { title: "asc" } })).map((n) => n.title)).toEqual(["Created: Pay rent", "Done: Pay rent"]);
    // Completing again, or editing something else, doesn't re-fire it.
    await updateTask(task.id, { status: "done" });
    await updateTask(task.id, { title: "Pay rent (late)" });
    await automationsIdle();
    expect(await prisma.workflowRun.count({ where: { workflowId: completed.id } })).toBe(1);
    expect(await prisma.workflowRun.count({ where: { workflowId: off.id } })).toBe(0);
  });

  it("an automation's own actions never start automations, so loops can't form", async () => {
    const loop = await wf({ name: "Loop", trigger: { type: "task_created" }, steps: [step({ type: "create_task", title: "Echo of {{trigger.title}}", description: "", priority: "medium", dueInDays: null, tags: "" })] });
    await updateWorkflow(loop.id, updateWorkflowSchema.parse({ enabled: true }));
    await createTask({ title: "Seed" });
    await automationsIdle();
    expect((await listTasks({})).map((t) => t.title).sort()).toEqual(["Echo of Seed", "Seed"]);
    expect(await prisma.workflowRun.count({ where: { workflowId: loop.id } })).toBe(1);
  });

  it("caps runaway automations at a number of runs per hour", async () => {
    const { id } = await wf({ steps: [note("n", "x")] });
    await prisma.workflowRun.createMany({ data: Array.from({ length: MAX_RUNS_PER_HOUR }, () => ({ workflowId: id, triggerType: "manual", status: "succeeded" as const })) });
    const outcome = await manual(id);
    expect(outcome.status).toBe("failed");
    expect((await getRun(outcome.runId)).error).toMatch(/ran 60 times in the last hour/);
    expect(await prisma.note.count()).toBe(0);
  });

  it("webhook addresses are secret, stored only as a hash, and replaceable", async () => {
    const { id } = await wf({ trigger: { type: "webhook" }, steps: [note("From {{trigger.source}}", "")] });
    const { token } = await rotateWebhookToken(id);
    expect(token).toMatch(/^omni_hook_/);
    const row = await prisma.workflow.findUniqueOrThrow({ where: { id } });
    expect(row.webhookTokenHash).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await findByWebhookToken(token)).toEqual({ id, enabled: false });
    expect(await findByWebhookToken(`${token}x`)).toBeNull();
    expect(await findByWebhookToken("omni_hook_nope")).toBeNull();
    expect(await findByWebhookToken("something-else")).toBeNull();
    const replacement = (await rotateWebhookToken(id)).token;
    expect(await findByWebhookToken(token)).toBeNull();
    expect(await findByWebhookToken(replacement)).not.toBeNull();
    // Only webhook automations get one, and switching trigger type removes it.
    const manualFlow = await wf({});
    await expect(rotateWebhookToken(manualFlow.id)).rejects.toMatchObject({ code: "not_a_webhook" });
    await updateWorkflow(id, updateWorkflowSchema.parse({ trigger: { type: "manual" } }));
    expect(await findByWebhookToken(replacement)).toBeNull();
  });
});

describe("scheduling (database)", () => {
  const hourly = { type: "schedule", schedule: { frequency: "interval", everyMinutes: 60, timezone: "UTC" } };

  it("sets the next run when switched on, runs when due, moves it forward, and never runs twice", async () => {
    const { id } = await wf({ trigger: hourly, steps: [note("Tick", "")] });
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id } })).nextRunAt).toBeNull();
    await updateWorkflow(id, updateWorkflowSchema.parse({ enabled: true }));
    const scheduled = (await prisma.workflow.findUniqueOrThrow({ where: { id } })).nextRunAt!;
    expect(scheduled.getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);

    expect(await tick(new Date())).toBe(0); // not due yet
    const later = new Date(scheduled.getTime() + 1_000);
    expect(await tick(later)).toBe(1);
    await automationsIdle();
    expect(await prisma.note.count()).toBe(1);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id } })).nextRunAt!.getTime()).toBeGreaterThan(later.getTime());
    expect(await tick(later)).toBe(0);
    await automationsIdle();
    expect(await prisma.note.count()).toBe(1);
  });

  it("two schedulers racing for the same run start it once", async () => {
    const { id } = await wf({ trigger: hourly, steps: [note("Once", "")] });
    await updateWorkflow(id, updateWorkflowSchema.parse({ enabled: true }));
    const due = new Date(Date.now() + 2 * 3_600_000);
    const [a, b] = await Promise.all([tick(due), tick(due)]);
    await automationsIdle();
    expect(a + b).toBe(1);
    expect(await prisma.note.count()).toBe(1);
  });

  it("doesn't run switched-off automations, and clears the next run when switched off", async () => {
    const { id } = await wf({ trigger: hourly, steps: [note("x", "")] });
    await updateWorkflow(id, updateWorkflowSchema.parse({ enabled: true }));
    await updateWorkflow(id, updateWorkflowSchema.parse({ enabled: false }));
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id } })).nextRunAt).toBeNull();
    expect(await tick(new Date(Date.now() + 5 * 3_600_000))).toBe(0);
  });

  it("refuses to switch on an automation with nothing to do", async () => {
    const { id } = await wf({ trigger: hourly });
    await expect(updateWorkflow(id, updateWorkflowSchema.parse({ enabled: true }))).rejects.toMatchObject({ code: "no_steps" });
  });

  it("marks runs interrupted by a restart as failed", async () => {
    const { id } = await wf({ steps: [note("x", "")] });
    const run = await prisma.workflowRun.create({ data: { workflowId: id, triggerType: "manual" } });
    await prisma.workflowRunStep.create({ data: { runId: run.id, index: 0, type: "create_note" } });
    expect(await recoverInterruptedRuns()).toBe(1);
    const recovered = await getRun(run.id);
    expect(recovered.status).toBe("failed");
    expect(recovered.error).toMatch(/restarted/);
    expect(recovered.steps[0].status).toBe("error");
    expect((await listRuns(id)).length).toBe(1);
  });
});

describe("validation", () => {
  it("rejects bad schedules, steps, and settings", () => {
    const bad = (value: unknown) => expect(() => createWorkflowSchema.parse(value)).toThrow();
    bad({ name: " ", trigger: { type: "manual" } });
    bad({ name: "x", trigger: { type: "telepathy" } });
    bad({ name: "x", trigger: { type: "schedule", schedule: { frequency: "interval", everyMinutes: 1, timezone: "UTC" } } });
    bad({ name: "x", trigger: { type: "schedule", schedule: { frequency: "daily", time: "25:00", timezone: "UTC" } } });
    bad({ name: "x", trigger: { type: "schedule", schedule: { frequency: "weekly", time: "09:00", days: [], timezone: "UTC" } } });
    bad({ name: "x", trigger: { type: "schedule", schedule: { frequency: "daily", time: "09:00", timezone: "Mars/Base" } } });
    bad({ name: "x", trigger: { type: "manual" }, steps: [{ id: "a", type: "rm_rf" }] });
    bad({ name: "x", trigger: { type: "manual" }, steps: [{ id: "a", type: "create_task", title: "" }] });
    bad({ name: "x", trigger: { type: "manual" }, steps: [{ id: "same", type: "create_note", title: "a", content: "" }, { id: "same", type: "create_note", title: "b", content: "" }] });
    bad({ name: "x", trigger: { type: "manual" }, steps: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, type: "create_note", title: "t", content: "" })) });
    bad({ name: "x", trigger: { type: "manual" }, steps: [{ id: "a", type: "http_request", method: "POST", url: "https://x.test", headers: [{ name: "bad header", value: "v" }] }] });
  });

  it("partial updates leave other fields alone", async () => {
    const { id } = await wf({ description: "keep", steps: [note("n", "c")] });
    const changed = await updateWorkflow(id, updateWorkflowSchema.parse({ name: "Renamed" }));
    expect(changed).toMatchObject({ name: "Renamed", description: "keep", enabled: false });
    expect(changed.steps).toHaveLength(1);
  });
});
