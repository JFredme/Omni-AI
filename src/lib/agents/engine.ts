import { ApiError } from "@/lib/api-error";
import { localDateKey } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { runAiJson } from "@/lib/ai/run";
import { OpenRouterError, userMessageFor } from "@/lib/openrouter/errors";
import { requireApiKey } from "@/lib/settings";
import { assertWithinBudget } from "@/lib/usage";
import { buildAgentPrompt, truncate, type HistoryStep } from "./prompt";
import { stepReplySchema, type StepReply } from "./schemas";
import { TOOLS, getTool, type ToolDef } from "./tools";
import type { Agent, AgentRun, AgentStep, Prisma } from "@/generated/prisma/client";

/** A delegated agent may itself delegate once more, never further. */
export const MAX_DEPTH = 2;
/** A whole run (including time spent waiting on the model) may not take longer than this. */
export const MAX_RUN_MS = 10 * 60_000;
const TOOL_TIMEOUT_MS = 30_000;
const MAX_INVALID_IN_A_ROW = 2;
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_KINDS = new Set(["rate_limited", "timeout", "network", "provider_error"]);
const TERMINAL = ["completed", "failed", "cancelled"] as const;

/** Tests shorten the pause between retries of a failed model call. */
export const engineConfig = { retryBaseMs: 1_000 };

// One set of in-flight runs per process, even when the dev server reloads this module.
const globalState = globalThis as unknown as { __omniAgents?: { active: Set<string>; controllers: Map<string, AbortController>; recovered: boolean } };
const state = (globalState.__omniAgents ??= { active: new Set(), controllers: new Map(), recovered: false });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(error: unknown): string {
  if (error instanceof OpenRouterError) return userMessageFor(error);
  if (error instanceof ApiError) return error.message;
  console.error("Agent run failed unexpectedly:", error);
  return "Something went wrong while running the agent. Check the server logs.";
}

function describeToolError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && !error.name.startsWith("Prisma")) return error.message;
  console.error("Agent tool failed unexpectedly:", error);
  return "The tool failed unexpectedly.";
}

/** Moves a run to a new status unless it already reached a final one (a cancelled run stays cancelled). */
async function transition(runId: string, status: AgentRun["status"], data: Prisma.AgentRunUpdateManyMutationInput = {}): Promise<boolean> {
  const final = (TERMINAL as readonly string[]).includes(status);
  const result = await prisma.agentRun.updateMany({
    where: { id: runId, status: { notIn: [...TERMINAL] } },
    data: { status, ...(final ? { finishedAt: new Date() } : {}), ...data },
  });
  return result.count > 0;
}

const fail = (runId: string, error: string) => transition(runId, "failed", { error });

/** Checks, before anything is created, that a run can actually start. */
async function assertCanRun() {
  await requireApiKey();
  await assertWithinBudget();
}

export async function startRun(input: { agentId: string; objective: string; parentRunId?: string; depth?: number; budgetUsd?: number }): Promise<AgentRun> {
  const agent = await prisma.agent.findUnique({ where: { id: input.agentId } });
  if (!agent) throw new ApiError(404, "not_found", "That agent no longer exists.");
  if (!input.parentRunId) {
    await assertCanRun();
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { defaultModelId: true } });
    if (!agent.modelId && !settings?.defaultModelId) {
      throw new ApiError(400, "model_required", "Choose a default model in Settings, or pick a model for this agent.");
    }
  }
  return prisma.agentRun.create({
    data: {
      agentId: agent.id,
      objective: input.objective,
      parentRunId: input.parentRunId ?? null,
      depth: input.depth ?? 0,
      budgetUsd: Math.min(agent.maxBudgetUsd, input.budgetUsd ?? agent.maxBudgetUsd),
    },
  });
}

/** Runs the agent in the background. Progress is stored in the database, so the caller doesn't wait. */
export function launchRun(runId: string): void {
  void runLoop(runId);
}

async function runLoop(runId: string): Promise<void> {
  for (let waited = 0; state.active.has(runId) && waited < 40; waited += 1) await sleep(50);
  if (state.active.has(runId)) return;
  state.active.add(runId);
  const controller = new AbortController();
  state.controllers.set(runId, controller);
  try {
    await loop(runId, controller);
  } catch (error) {
    await fail(runId, describeError(error));
  } finally {
    state.active.delete(runId);
    state.controllers.delete(runId);
  }
}

function allowedTools(agent: Agent, depth: number, computerAllowed: boolean): ToolDef[] {
  return TOOLS.filter((tool) => agent.tools.includes(tool.name) && (tool.name !== "delegate" || depth < MAX_DEPTH) && (tool.risk !== "computer" || computerAllowed));
}

async function recordStep(
  run: Pick<AgentRun, "id" | "stepCount">,
  data: { kind: AgentStep["kind"]; thought?: string | null; tool?: string | null; input?: unknown; output?: string | null; status: AgentStep["status"] },
): Promise<AgentStep> {
  const [step] = await prisma.$transaction([
    prisma.agentStep.create({
      data: {
        runId: run.id,
        index: run.stepCount,
        kind: data.kind,
        thought: data.thought ?? null,
        tool: data.tool ?? null,
        input: data.input === undefined ? undefined : (data.input as Prisma.InputJsonValue),
        output: data.output ?? null,
        status: data.status,
      },
    }),
    prisma.agentRun.update({ where: { id: run.id }, data: { stepCount: { increment: 1 } } }),
  ]);
  return step;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The tool took longer than ${ms / 1000} seconds.`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function executeStep(step: AgentStep, run: AgentRun, agent: Agent, signal: AbortSignal): Promise<void> {
  await prisma.agentStep.update({ where: { id: step.id }, data: { status: "running" } });
  const def = step.tool ? getTool(step.tool) : undefined;
  let output: string;
  let status: AgentStep["status"] = "ok";
  try {
    if (!def) throw new Error(`Unknown tool "${step.tool}".`);
    const context = {
      runId: run.id,
      depth: run.depth,
      signal,
      delegate: (name: string, objective: string) => delegateTo(run, agent, name, objective),
    };
    const pending = def.run((step.input ?? {}) as never, context);
    const value = def.name === "delegate" ? await pending : await withTimeout(pending, TOOL_TIMEOUT_MS);
    output = truncate(JSON.stringify(value ?? null));
  } catch (error) {
    status = "error";
    output = `Error: ${describeToolError(error)}`;
  }
  await prisma.agentStep.update({ where: { id: step.id }, data: { status, output } });
}

async function delegateTo(parent: AgentRun, agent: Agent, name: string, objective: string): Promise<string> {
  const target = await prisma.agent.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: { id: agent.id } } });
  if (!target) throw new Error(`No other agent is named "${name}".`);
  const current = await prisma.agentRun.findUniqueOrThrow({ where: { id: parent.id } });
  const remaining = current.budgetUsd - current.costUsd;
  if (remaining <= 0.001) throw new Error("There is no budget left to delegate with.");

  const child = await startRun({ agentId: target.id, objective, parentRunId: parent.id, depth: parent.depth + 1, budgetUsd: remaining });
  await runLoop(child.id);
  const done = await prisma.agentRun.findUniqueOrThrow({ where: { id: child.id } });
  await prisma.agentRun.update({ where: { id: parent.id }, data: { costUsd: { increment: done.costUsd }, totalTokens: { increment: done.totalTokens } } });
  if (done.status === "completed") return done.result ?? "";
  throw new Error(`The ${target.name} agent did not finish (${done.status})${done.error ? `: ${done.error}` : ""}`);
}

async function askModel(agent: Agent, run: AgentRun, prompt: { system: string; user: string }, signal: AbortSignal): Promise<StepReply> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { data } = await runAiJson({
        ...prompt,
        schema: stepReplySchema,
        modelId: agent.modelId ?? undefined,
        signal,
        onUsage: async (usage) => {
          await prisma.agentRun.update({
            where: { id: run.id },
            data: { costUsd: { increment: usage.costUsd ?? 0 }, totalTokens: { increment: usage.totalTokens } },
          });
        },
      });
      return data;
    } catch (error) {
      const transient = error instanceof OpenRouterError && TRANSIENT_KINDS.has(error.kind);
      if (!transient || attempt >= MAX_TRANSIENT_RETRIES || signal.aborted) throw error;
      await sleep(engineConfig.retryBaseMs * 2 ** attempt);
    }
  }
}

async function loop(runId: string, controller: AbortController): Promise<void> {
  const first = await prisma.agentRun.findUnique({ where: { id: runId }, include: { agent: true } });
  if (!first || (TERMINAL as readonly string[]).includes(first.status)) return;
  const agent = first.agent;

  if (!first.startedAt) await prisma.agentRun.update({ where: { id: runId }, data: { startedAt: new Date() } });
  // A step still "running" belongs to a process that died. Don't repeat it: tell the model it may have happened.
  await prisma.agentStep.updateMany({
    where: { runId, status: "running" },
    data: { status: "error", output: "Error: interrupted before it finished; it may or may not have completed. Check before repeating it." },
  });
  if (!(await transition(runId, "running"))) return;

  let invalidInARow = 0;
  for (;;) {
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    if ((TERMINAL as readonly string[]).includes(run.status) || controller.signal.aborted) return;
    if (Date.now() - (run.startedAt ?? run.createdAt).getTime() > MAX_RUN_MS) {
      await fail(runId, `Stopped after ${MAX_RUN_MS / 60_000} minutes without finishing.`);
      return;
    }
    if (run.costUsd >= run.budgetUsd) {
      await fail(runId, `Stopped at its spending limit ($${run.costUsd.toFixed(4)} of $${run.budgetUsd.toFixed(2)}).`);
      return;
    }

    const steps = await prisma.agentStep.findMany({ where: { runId }, orderBy: { index: "asc" } });
    if (steps.some((step) => step.status === "pending_approval")) {
      await transition(runId, "awaiting_approval");
      return;
    }
    const approved = steps.find((step) => step.status === "approved");
    if (approved) {
      await executeStep(approved, run, agent, controller.signal);
      continue;
    }

    if (run.stepCount >= agent.maxSteps) {
      await fail(runId, `Stopped after ${agent.maxSteps} steps without finishing.`);
      return;
    }

    const computerAllowed = (await prisma.appSettings.findUnique({ where: { id: 1 }, select: { computerControl: true } }))?.computerControl === true;
    const tools = allowedTools(agent, run.depth, computerAllowed);
    const delegates = tools.some((tool) => tool.name === "delegate")
      ? (await prisma.agent.findMany({ where: { NOT: { id: agent.id } }, select: { name: true }, orderBy: { name: "asc" } })).map((row) => row.name)
      : [];
    const prompt = buildAgentPrompt({
      agentName: agent.name,
      instructions: agent.instructions,
      objective: run.objective,
      today: localDateKey(),
      tools,
      steps: steps as HistoryStep[],
      stepsLeft: agent.maxSteps - run.stepCount,
      delegates,
    });

    let reply: StepReply | null = null;
    try {
      reply = await askModel(agent, run, prompt, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof ApiError && error.code === "ai_invalid_response")) throw error;
    }

    if (reply && !reply.action && typeof reply.final === "string" && reply.final.trim()) {
      await recordStep(run, { kind: "final", thought: reply.thought, output: reply.final.trim(), status: "ok" });
      await transition(runId, "completed", { result: reply.final.trim() });
      return;
    }

    if (!reply || !reply.action) {
      invalidInARow += 1;
      await recordStep(run, {
        kind: "invalid",
        output: 'Reply with exactly one JSON object: either { "thought": ..., "action": { "tool": ..., "args": ... } } or { "final": ... }.',
        status: "error",
      });
      if (invalidInARow > MAX_INVALID_IN_A_ROW) {
        await fail(runId, "The model kept replying in an unusable format. Try a different model.");
        return;
      }
      continue;
    }
    invalidInARow = 0;

    const toolName = reply.action.tool;
    const def = tools.find((tool) => tool.name === toolName);
    const base = { kind: "action" as const, thought: reply.thought, tool: toolName, input: reply.action.args ?? {} };
    if (!def) {
      await recordStep(run, { ...base, status: "error", output: `Error: "${toolName}" is not an available tool. Available: ${tools.map((tool) => tool.name).join(", ") || "none"}.` });
      continue;
    }
    const parsed = def.args.safeParse(reply.action.args ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      await recordStep(run, { ...base, status: "error", output: `Error: invalid arguments: ${issue?.path.join(".") || "args"} ${issue?.message ?? "is invalid"}.` });
      continue;
    }

    // Anything that uses the computer always asks, whatever the agent's own settings say.
    const needsApproval = agent.approvalTools.includes(def.name) || def.risk === "computer";
    if (needsApproval && run.depth > 0) {
      await recordStep(run, {
        ...base,
        input: parsed.data,
        status: "error",
        output: `Error: "${def.name}" needs the user's approval, which can't be asked for inside a delegated task. Do something else, or say what you could not do.`,
      });
      continue;
    }
    if (needsApproval) {
      await recordStep(run, { ...base, input: parsed.data, status: "pending_approval" });
      await transition(runId, "awaiting_approval");
      return;
    }
    const step = await recordStep(run, { ...base, input: parsed.data, status: "running" });
    await executeStep(step, { ...run, stepCount: run.stepCount + 1 }, agent, controller.signal);
  }
}

/** Approves or declines the action a paused run is waiting on, then resumes the run. */
export async function decideStep(runId: string, stepId: string, decision: "approve" | "reject"): Promise<void> {
  const step = await prisma.agentStep.findFirst({ where: { id: stepId, runId, status: "pending_approval" }, include: { run: true } });
  if (!step || step.run.status !== "awaiting_approval") {
    throw new ApiError(409, "not_pending", "That action is no longer waiting for approval.");
  }
  await prisma.agentStep.update({
    where: { id: stepId },
    data: decision === "approve" ? { status: "approved" } : { status: "rejected", output: "The user declined this action." },
  });
  await transition(runId, "running");
  launchRun(runId);
}

/** Cancels a run and anything it delegated to. Work already in flight is aborted. */
export async function cancelRun(runId: string): Promise<void> {
  const ids = [runId];
  for (let cursor = 0; cursor < ids.length; cursor += 1) {
    const children = await prisma.agentRun.findMany({ where: { parentRunId: ids[cursor] }, select: { id: true } });
    ids.push(...children.map((child) => child.id));
  }
  for (const id of ids) {
    await transition(id, "cancelled");
    await prisma.agentStep.updateMany({
      where: { runId: id, status: "pending_approval" },
      data: { status: "rejected", output: "The run was cancelled." },
    });
    state.controllers.get(id)?.abort();
  }
}

/**
 * Picks up runs that were in progress when the server last stopped. Runs waiting for approval stay paused.
 * Safe to call often; it only does work once per process.
 */
export async function recoverRuns(): Promise<void> {
  if (state.recovered) return;
  state.recovered = true;
  const stuck = await prisma.agentRun.findMany({ where: { status: { in: ["queued", "running"] } }, select: { id: true, parentRunId: true } });
  for (const run of stuck) {
    // A delegated run is resumed by its parent's step; resuming it separately would run it twice.
    if (run.parentRunId) await fail(run.id, "Interrupted when the server restarted.");
    else if (!state.active.has(run.id)) launchRun(run.id);
  }
}

/** Test helper: lets recovery run again. */
export function resetRecoveryForTests() {
  state.recovered = false;
}

/** Test helper: resolves once no run loop is active in this process. */
export async function idle(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (state.active.size > 0) {
    if (Date.now() > deadline) throw new Error("agent runs did not settle");
    await sleep(20);
  }
}
