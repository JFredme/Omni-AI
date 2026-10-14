import { describe, expect, it } from "vitest";
import { BUILT_IN_AGENTS, approvalFor } from "./builtins";
import { createAgentSchema, decisionSchema, startRunSchema, stepReplySchema, updateAgentSchema } from "./schemas";
import { TOOLS, getTool, toolCatalog } from "./tools";

describe("agent schemas", () => {
  it("applies safe defaults", () => {
    expect(createAgentSchema.parse({ name: " Helper " })).toMatchObject({
      name: "Helper",
      tools: [],
      approvalTools: [],
      maxSteps: 10,
      maxBudgetUsd: 0.25,
      modelId: null,
    });
  });

  it("rejects unknown tools, out-of-range limits, and approvals for tools that aren't enabled", () => {
    expect(() => createAgentSchema.parse({ name: "x", tools: ["rm_rf"] })).toThrow();
    expect(() => createAgentSchema.parse({ name: "x", maxSteps: 0 })).toThrow();
    expect(() => createAgentSchema.parse({ name: "x", maxSteps: 31 })).toThrow();
    expect(() => createAgentSchema.parse({ name: "x", maxBudgetUsd: 100 })).toThrow();
    expect(() => createAgentSchema.parse({ name: "x", tools: ["list_tasks"], approvalTools: ["create_task"] })).toThrow(/must also be an enabled tool/);
    expect(() => createAgentSchema.parse({ name: "  " })).toThrow();
    expect(() => updateAgentSchema.parse({ tools: [], approvalTools: ["create_task"] })).toThrow();
    expect(updateAgentSchema.parse({ name: "Only name" })).toEqual({ name: "Only name" });
  });

  it("validates run requests, decisions, and model replies", () => {
    expect(() => startRunSchema.parse({ agentId: "a", objective: "   " })).toThrow();
    expect(() => decisionSchema.parse({ decision: "maybe" })).toThrow();
    expect(stepReplySchema.parse({ final: "done" }).final).toBe("done");
    expect(stepReplySchema.parse({ action: { tool: "list_tasks" } }).action?.tool).toBe("list_tasks");
    expect(() => stepReplySchema.parse({ action: "list_tasks" })).toThrow();
  });
});

describe("tool registry and built-in agents", () => {
  it("has unique tool names, each with a schema, usage text, and a risk level", () => {
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
    for (const tool of toolCatalog()) {
      expect(tool.usage.length).toBeGreaterThan(1);
      expect(["read", "write"]).toContain(tool.risk);
    }
    expect(getTool("nope")).toBeUndefined();
  });

  it("validates tool arguments", () => {
    const create = getTool("create_task")!;
    expect(create.args.safeParse({ title: "x", priority: "urgent", dueDate: "2026-02-30" }).success).toBe(false);
    expect(create.args.safeParse({ title: "x", tags: ["#A", "a"] })).toMatchObject({ success: true, data: { tags: ["a"] } });
    expect(getTool("update_task")!.args.safeParse({ title: "no id" }).success).toBe(false);
  });

  it("only lists tools that exist, and asks before every write", () => {
    const names = new Set(TOOLS.map((tool) => tool.name));
    expect(new Set(BUILT_IN_AGENTS.map((agent) => agent.key)).size).toBe(BUILT_IN_AGENTS.length);
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.tools.every((name) => names.has(name))).toBe(true);
      const writes = agent.tools.filter((name) => getTool(name)?.risk === "write");
      expect(approvalFor(agent.tools).sort()).toEqual(writes.sort());
      expect(agent.maxSteps).toBeLessThanOrEqual(30);
    }
  });
});
