import { prisma } from "@/lib/db";
import { localDateKey } from "@/lib/dates";
import { Prisma } from "@/generated/prisma/client";
import { OpenRouterError, userMessageFor } from "@/lib/openrouter/errors";
import { ApiError } from "@/lib/api-error";
import { automationContext, pendingEvents, type AppEventType } from "./events";
import { nextRunAfter } from "./schedule";
import { stepsSchema, triggerSchema } from "./schemas";
import { executeStep } from "./steps";
import { BlockedUrlError } from "./ssrf";
import type { TemplateContext } from "./template";
import type { Step, Trigger, TriggerType } from "./types";

export const MAX_RUN_MS = 5 * 60_000;
export const MAX_RUNS_PER_HOUR = 60;

interface State {
  timer: ReturnType<typeof setInterval> | null;
  running: Set<string>;
  inflight: Set<Promise<unknown>>;
}
const holder = globalThis as { __omniAutomations?: State };
const state: State = (holder.__omniAutomations ??= { timer: null, running: new Set(), inflight: new Set() });

function track<T>(promise: Promise<T>): Promise<T> {
  state.inflight.add(promise);
  void promise.finally(() => state.inflight.delete(promise)).catch(() => undefined);
  return promise;
}

/** Resolves once nothing is running. Used by tests so one test's work doesn't leak into the next. */
export async function automationsIdle(): Promise<void> {
  while (state.inflight.size > 0 || pendingEvents.size > 0) await Promise.allSettled([...state.inflight, ...pendingEvents]);
}

function describeFailure(error: unknown): string {
  if (error instanceof OpenRouterError) return userMessageFor(error);
  if (error instanceof ApiError || error instanceof BlockedUrlError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "A step took too long and was stopped.";
  if (error instanceof Error && error.name === "AbortError") return "The run was stopped.";
  if (error instanceof Error && error.name === "ZodError") return "A step's settings were invalid.";
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  return "Something went wrong.";
}

export interface RunOutcome {
  runId: string;
  status: "succeeded" | "failed" | "skipped";
}

/** Runs a workflow now. Records the run and every step as it goes. */
export async function runWorkflow(workflowId: string, trigger: { type: TriggerType; data: Record<string, unknown> }): Promise<RunOutcome> {
  return track(executeRun(workflowId, trigger));
}

async function executeRun(workflowId: string, trigger: { type: TriggerType; data: Record<string, unknown> }): Promise<RunOutcome> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new ApiError(404, "not_found", "That automation no longer exists.");

  const recent = await prisma.workflowRun.count({ where: { workflowId, startedAt: { gte: new Date(Date.now() - 3_600_000) } } });
  if (recent >= MAX_RUNS_PER_HOUR) {
    const run = await prisma.workflowRun.create({
      data: { workflowId, triggerType: trigger.type, status: "failed", error: `Stopped: this automation already ran ${MAX_RUNS_PER_HOUR} times in the last hour. Check that it isn't triggering itself.`, finishedAt: new Date() },
    });
    return { runId: run.id, status: "failed" };
  }

  const steps = stepsSchema.safeParse(workflow.steps);
  const run = await prisma.workflowRun.create({
    data: { workflowId, triggerType: trigger.type, triggerData: trigger.data as Prisma.InputJsonValue },
  });
  if (!steps.success) {
    await prisma.workflowRun.update({ where: { id: run.id }, data: { status: "failed", error: "This automation's steps are saved in a form that can't be read. Open it and save it again.", finishedAt: new Date() } });
    return { runId: run.id, status: "failed" };
  }

  const timeout = AbortSignal.timeout(MAX_RUN_MS);
  const context: TemplateContext = { trigger: trigger.data, steps: {}, today: localDateKey(), now: new Date().toISOString() };
  let status: RunOutcome["status"] = "succeeded";
  let error: string | null = null;

  await automationContext.run({ runId: run.id }, async () => {
    for (const [index, step] of (steps.data as Step[]).entries()) {
      if (status !== "succeeded") {
        await prisma.workflowRunStep.create({ data: { runId: run.id, index, type: step.type, status: "skipped", finishedAt: new Date() } });
        continue;
      }
      const row = await prisma.workflowRunStep.create({ data: { runId: run.id, index, type: step.type, status: "running" } });
      try {
        const result = await executeStep(step, context, timeout);
        context.steps[String(index + 1)] = { output: result.output };
        await prisma.workflowRunStep.update({
          where: { id: row.id },
          data: { status: "ok", input: toJson(result.input), output: toJson(result.output), finishedAt: new Date() },
        });
        if (result.stop) status = "skipped";
      } catch (caught) {
        status = "failed";
        error = `Step ${index + 1} failed: ${describeFailure(caught)}`;
        const extra = caught as { input?: unknown; output?: unknown };
        await prisma.workflowRunStep.update({
          where: { id: row.id },
          data: { status: "error", error: describeFailure(caught), input: toJson(extra.input), output: toJson(extra.output), finishedAt: new Date() },
        });
      }
    }
  });

  await prisma.$transaction([
    prisma.workflowRun.update({ where: { id: run.id }, data: { status, error, finishedAt: new Date() } }),
    prisma.workflow.updateMany({ where: { id: workflowId }, data: { lastRunAt: new Date() } }),
  ]);
  return { runId: run.id, status };
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Starts every enabled automation listening for this event. Failures are logged, never thrown. */
export async function dispatchEvent(type: AppEventType, payload: Record<string, unknown>): Promise<void> {
  const workflows = await prisma.workflow.findMany({ where: { enabled: true, trigger: { path: ["type"], equals: type } }, select: { id: true } });
  await Promise.all(
    workflows.map((workflow) =>
      runWorkflow(workflow.id, { type, data: payload }).catch((error) => console.error("An automation failed to start:", error)),
    ),
  );
}

export function nextRunFor(trigger: Trigger, after: Date = new Date()): Date | null {
  return trigger.type === "schedule" ? nextRunAfter(trigger.schedule, after) : null;
}

/** One scheduler pass: runs whatever is due, and moves each schedule's next run forward first so it can't run twice. */
export async function tick(now: Date = new Date()): Promise<number> {
  const due = await prisma.workflow.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, take: 20 });
  let started = 0;
  for (const workflow of due) {
    const trigger = triggerSchema.safeParse(workflow.trigger);
    if (!trigger.success || trigger.data.type !== "schedule" || !workflow.nextRunAt) continue;
    const next = nextRunAfter(trigger.data.schedule, now);
    // Whoever changes nextRunAt from the value we saw owns this run; a second instance's update would match nothing.
    const claimed = await prisma.workflow.updateMany({ where: { id: workflow.id, nextRunAt: workflow.nextRunAt }, data: { nextRunAt: next } });
    if (claimed.count !== 1) continue;
    started += 1;
    void runWorkflow(workflow.id, { type: "schedule", data: { scheduledFor: workflow.nextRunAt.toISOString() } }).catch((error) => console.error("A scheduled automation failed to start:", error));
  }
  return started;
}

/** Runs left "running" by a crash or restart can never finish. Mark them failed so history tells the truth. */
export async function recoverInterruptedRuns(): Promise<number> {
  const stuck = await prisma.workflowRun.findMany({ where: { status: "running" }, select: { id: true } });
  if (stuck.length === 0) return 0;
  const ids = stuck.map((run) => run.id);
  await prisma.$transaction([
    prisma.workflowRunStep.updateMany({ where: { runId: { in: ids }, status: "running" }, data: { status: "error", error: "The server restarted while this step was running.", finishedAt: new Date() } }),
    prisma.workflowRun.updateMany({ where: { id: { in: ids } }, data: { status: "failed", error: "The server restarted while this automation was running.", finishedAt: new Date() } }),
  ]);
  return ids.length;
}

/** Starts the once-a-while check for due automations. Safe to call more than once. */
export async function startScheduler(intervalMs = 20_000): Promise<void> {
  if (state.timer) return;
  await recoverInterruptedRuns().catch((error) => console.error("Couldn't clean up interrupted automations:", error));
  state.timer = setInterval(() => {
    void tick().catch((error) => console.error("The automation scheduler hit a problem:", error));
  }, intervalMs);
  state.timer.unref?.();
}

export function stopScheduler(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}
