import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import type { Agent } from "@/generated/prisma/client";
import { approvalFor, BUILT_IN_AGENTS } from "./builtins";
import type { AgentDto } from "./types";

export function serializeAgent(row: Agent): AgentDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    modelId: row.modelId,
    tools: row.tools,
    approvalTools: row.approvalTools,
    maxSteps: row.maxSteps,
    maxBudgetUsd: row.maxBudgetUsd,
    builtIn: row.builtInKey !== null,
  };
}

/** Keeps the built-in agents in the database in line with their definitions in code. */
export async function ensureBuiltInAgents(): Promise<void> {
  for (const agent of BUILT_IN_AGENTS) {
    const data = {
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      tools: agent.tools,
      approvalTools: approvalFor(agent.tools),
      maxSteps: agent.maxSteps,
      maxBudgetUsd: agent.maxBudgetUsd,
    };
    await prisma.agent.upsert({ where: { builtInKey: agent.key }, create: { builtInKey: agent.key, ...data }, update: data });
  }
}

export async function listAgents(): Promise<AgentDto[]> {
  await ensureBuiltInAgents();
  const rows = await prisma.agent.findMany({ orderBy: [{ builtInKey: { sort: "asc", nulls: "last" } }, { name: "asc" }] });
  return rows.map(serializeAgent);
}

export async function getAgent(id: string): Promise<AgentDto> {
  const row = await prisma.agent.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "That agent no longer exists.");
  return serializeAgent(row);
}

export async function createAgent(input: Omit<AgentDto, "id" | "builtIn">): Promise<AgentDto> {
  const row = await prisma.agent.create({ data: input });
  return serializeAgent(row);
}

async function assertEditable(id: string) {
  const row = await prisma.agent.findUnique({ where: { id }, select: { builtInKey: true } });
  if (!row) throw new ApiError(404, "not_found", "That agent no longer exists.");
  if (row.builtInKey) throw new ApiError(400, "built_in_readonly", "Built-in agents can't be changed. Duplicate it to customize a copy.");
}

export async function updateAgent(id: string, patch: Partial<Omit<AgentDto, "id" | "builtIn">>): Promise<AgentDto> {
  await assertEditable(id);
  const current = await prisma.agent.findUniqueOrThrow({ where: { id } });
  const tools = patch.tools ?? current.tools;
  const row = await prisma.agent.update({
    where: { id },
    // Removing a tool also drops it from the approval list so the two never disagree.
    data: { ...patch, approvalTools: (patch.approvalTools ?? current.approvalTools).filter((name) => tools.includes(name)) },
  });
  return serializeAgent(row);
}

export async function deleteAgent(id: string): Promise<void> {
  await assertEditable(id);
  await prisma.agent.delete({ where: { id } });
}
