import { z } from "zod";
import { TOOLS } from "./tools";

export const MAX_AGENT_STEPS = 30;
export const MAX_AGENT_BUDGET_USD = 5;

const toolName = z.string().refine((name) => TOOLS.some((tool) => tool.name === name), { message: "is not a known tool" });

const agentFields = {
  name: z.string().trim().min(1, "Give the agent a name").max(80),
  description: z.string().trim().max(500).default(""),
  instructions: z.string().max(8_000).default(""),
  modelId: z.string().trim().min(1).max(200).nullable().default(null),
  tools: z.array(toolName).max(TOOLS.length).default([]),
  approvalTools: z.array(toolName).max(TOOLS.length).default([]),
  maxSteps: z.number().int().min(1).max(MAX_AGENT_STEPS).default(10),
  maxBudgetUsd: z.number().min(0.01).max(MAX_AGENT_BUDGET_USD).default(0.25),
};

function approvalsAreTools(value: { tools: string[]; approvalTools: string[] }, context: z.RefinementCtx) {
  for (const name of value.approvalTools) {
    if (!value.tools.includes(name)) {
      context.addIssue({ code: "custom", path: ["approvalTools"], message: `"${name}" must also be an enabled tool` });
    }
  }
}

export const createAgentSchema = z.object(agentFields).superRefine(approvalsAreTools);

export const updateAgentSchema = z
  .object(agentFields)
  .partial()
  .superRefine((value, context) => {
    if (value.tools && value.approvalTools) approvalsAreTools({ tools: value.tools, approvalTools: value.approvalTools }, context);
  });

export const startRunSchema = z.object({
  agentId: z.string().trim().min(1).max(60),
  objective: z.string().trim().min(1, "Describe what the agent should do").max(4_000),
});

export const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });

/** What the model must return on each step. */
export const stepReplySchema = z.object({
  thought: z.string().nullish(),
  action: z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).nullish() }).nullish(),
  final: z.string().nullish(),
});
export type StepReply = z.infer<typeof stepReplySchema>;
