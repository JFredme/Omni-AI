import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import type { Agent, AgentRun, AgentStep } from "@/generated/prisma/client";
import { recoverRuns } from "./engine";
import type { AgentRunDto, AgentRunSummaryDto, AgentStepDto } from "./types";

type RunWithAgent = AgentRun & { agent: Pick<Agent, "name" | "maxSteps"> };

function summarize(run: RunWithAgent): AgentRunSummaryDto {
  return {
    id: run.id,
    agentId: run.agentId,
    agentName: run.agent.name,
    parentRunId: run.parentRunId,
    depth: run.depth,
    objective: run.objective,
    status: run.status,
    stepCount: run.stepCount,
    totalTokens: run.totalTokens,
    costUsd: run.costUsd,
    budgetUsd: run.budgetUsd,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

function serializeStep(step: AgentStep): AgentStepDto {
  return {
    id: step.id,
    index: step.index,
    kind: step.kind,
    thought: step.thought,
    tool: step.tool,
    input: step.input,
    output: step.output,
    status: step.status,
    createdAt: step.createdAt.toISOString(),
  };
}

export async function listRuns(options: { agentId?: string; limit?: number } = {}): Promise<AgentRunSummaryDto[]> {
  await recoverRuns();
  const rows = await prisma.agentRun.findMany({
    where: { parentRunId: null, ...(options.agentId ? { agentId: options.agentId } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 30,
    include: { agent: { select: { name: true, maxSteps: true } } },
  });
  return rows.map(summarize);
}

export async function getRun(id: string): Promise<AgentRunDto> {
  await recoverRuns();
  const row = await prisma.agentRun.findUnique({
    where: { id },
    include: {
      agent: { select: { name: true, maxSteps: true } },
      steps: { orderBy: { index: "asc" } },
      childRuns: { orderBy: { createdAt: "asc" }, include: { agent: { select: { name: true, maxSteps: true } } } },
    },
  });
  if (!row) throw new ApiError(404, "not_found", "That run no longer exists.");
  return {
    ...summarize(row),
    result: row.result,
    error: row.error,
    maxSteps: row.agent.maxSteps,
    steps: row.steps.map(serializeStep),
    childRuns: row.childRuns.map(summarize),
  };
}
