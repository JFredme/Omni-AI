/** Safe to import from browser code: no server-only dependencies. */
export const MAX_AGENT_STEPS = 30;
export const MAX_AGENT_BUDGET_USD = 5;

export type AgentRunStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type AgentStepKind = "action" | "final" | "invalid";
export type AgentStepStatus = "pending_approval" | "approved" | "running" | "rejected" | "ok" | "error";

export interface AgentDto {
  id: string;
  name: string;
  description: string;
  instructions: string;
  modelId: string | null;
  tools: string[];
  approvalTools: string[];
  maxSteps: number;
  maxBudgetUsd: number;
  builtIn: boolean;
}

export interface AgentStepDto {
  id: string;
  index: number;
  kind: AgentStepKind;
  thought: string | null;
  tool: string | null;
  input: unknown;
  output: string | null;
  status: AgentStepStatus;
  createdAt: string;
}

export interface AgentRunSummaryDto {
  id: string;
  agentId: string;
  agentName: string;
  parentRunId: string | null;
  depth: number;
  objective: string;
  status: AgentRunStatus;
  stepCount: number;
  totalTokens: number;
  costUsd: number;
  budgetUsd: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AgentRunDto extends AgentRunSummaryDto {
  result: string | null;
  error: string | null;
  maxSteps: number;
  steps: AgentStepDto[];
  childRuns: AgentRunSummaryDto[];
}

export const ACTIVE_STATUSES: AgentRunStatus[] = ["queued", "running", "awaiting_approval"];
export const isActiveStatus = (status: AgentRunStatus) => ACTIVE_STATUSES.includes(status);
