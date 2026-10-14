import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { Prisma, type Workflow, type WorkflowRun, type WorkflowRunStep } from "@/generated/prisma/client";
import { nextRunFor } from "./engine";
import { stepsSchema, triggerSchema, type CreateWorkflowInput, type UpdateWorkflowInput } from "./schemas";
import type { RunDto, RunStepDto, RunStatus, Step, StepType, Trigger, TriggerType, WorkflowDto } from "./types";

type Row = Workflow & { runs?: { status: RunStatus }[] };

function serialize(row: Row): WorkflowDto {
  const trigger = triggerSchema.safeParse(row.trigger);
  const steps = stepsSchema.safeParse(row.steps);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    trigger: (trigger.success ? trigger.data : { type: "manual" }) as Trigger,
    steps: (steps.success ? steps.data : []) as Step[],
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    hasWebhook: row.webhookTokenHash !== null,
    lastRunStatus: row.runs?.[0]?.status ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const withLastRun = { runs: { orderBy: { startedAt: "desc" as const }, take: 1, select: { status: true } } };

export async function listWorkflows(): Promise<WorkflowDto[]> {
  const rows = await prisma.workflow.findMany({ orderBy: { createdAt: "desc" }, include: withLastRun, take: 200 });
  return rows.map(serialize);
}

export async function getWorkflow(id: string): Promise<WorkflowDto> {
  const row = await prisma.workflow.findUnique({ where: { id }, include: withLastRun });
  if (!row) throw new ApiError(404, "not_found", "That automation no longer exists.");
  return serialize(row);
}

function assertRunnable(trigger: Trigger, steps: Step[]) {
  if (steps.length === 0) throw new ApiError(400, "no_steps", "Add at least one step before switching this automation on.");
  if (trigger.type === "manual") return;
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<WorkflowDto> {
  const row = await prisma.workflow.create({
    data: { name: input.name, description: input.description, trigger: input.trigger as Prisma.InputJsonValue, steps: input.steps as Prisma.InputJsonValue },
    include: withLastRun,
  });
  return serialize(row);
}

export async function updateWorkflow(id: string, patch: UpdateWorkflowInput): Promise<WorkflowDto> {
  const existing = await prisma.workflow.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "That automation no longer exists.");
  const current = serialize(existing);
  const trigger = (patch.trigger ?? current.trigger) as Trigger;
  const steps = (patch.steps ?? current.steps) as Step[];
  const enabled = patch.enabled ?? existing.enabled;
  if (enabled) assertRunnable(trigger, steps);

  const triggerChanged = patch.trigger !== undefined && JSON.stringify(patch.trigger) !== JSON.stringify(current.trigger);
  const becameEnabled = patch.enabled === true && !existing.enabled;
  const nextRunAt = !enabled ? null : triggerChanged || becameEnabled || !existing.nextRunAt ? nextRunFor(trigger) : existing.nextRunAt;

  const row = await prisma.workflow.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.trigger !== undefined ? { trigger: patch.trigger as Prisma.InputJsonValue } : {}),
      ...(patch.steps !== undefined ? { steps: patch.steps as Prisma.InputJsonValue } : {}),
      enabled,
      nextRunAt,
      // A webhook address is only meaningful for webhook automations.
      ...(trigger.type !== "webhook" ? { webhookTokenHash: null } : {}),
    },
    include: withLastRun,
  });
  return serialize(row);
}

export async function deleteWorkflow(id: string): Promise<void> {
  const result = await prisma.workflow.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That automation no longer exists.");
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN_PREFIX = "omni_hook_";

/** Creates (or replaces) the secret for a webhook automation. The secret is returned once; only its hash is kept. */
export async function rotateWebhookToken(id: string): Promise<{ token: string }> {
  const workflow = await getWorkflow(id);
  if (workflow.trigger.type !== "webhook") throw new ApiError(400, "not_a_webhook", "Only automations that start from a web address have one.");
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  await prisma.workflow.update({ where: { id }, data: { webhookTokenHash: hashToken(token) } });
  return { token };
}

export async function findByWebhookToken(token: string): Promise<{ id: string; enabled: boolean } | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
  return prisma.workflow.findUnique({ where: { webhookTokenHash: hashToken(token) }, select: { id: true, enabled: true } });
}

type RunRow = WorkflowRun & { steps?: WorkflowRunStep[]; workflow?: { name: string } };

function serializeRun(row: RunRow): RunDto {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflow?.name,
    status: row.status,
    triggerType: row.triggerType as TriggerType,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    steps: (row.steps ?? [])
      .sort((a, b) => a.index - b.index)
      .map((step): RunStepDto => ({
        id: step.id,
        index: step.index,
        type: step.type as StepType,
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error,
        startedAt: step.startedAt.toISOString(),
        finishedAt: step.finishedAt?.toISOString() ?? null,
      })),
  };
}

export async function listRuns(workflowId: string | null, limit = 30): Promise<RunDto[]> {
  const rows = await prisma.workflowRun.findMany({
    where: workflowId ? { workflowId } : {},
    orderBy: { startedAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    include: { steps: true, workflow: { select: { name: true } } },
  });
  return rows.map(serializeRun);
}

export async function getRun(id: string): Promise<RunDto> {
  const row = await prisma.workflowRun.findUnique({ where: { id }, include: { steps: true, workflow: { select: { name: true } } } });
  if (!row) throw new ApiError(404, "not_found", "That run no longer exists.");
  return serializeRun(row);
}
