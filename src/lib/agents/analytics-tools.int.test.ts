// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { BUILT_IN_AGENTS, approvalFor } from "./builtins";
import { getTool } from "./tools";

const context = { runId: "r", depth: 0 };

beforeEach(async () => {
  assertTestDatabase();
  await prisma.workflow.deleteMany();
  await prisma.task.deleteMany();
});

describe("analytics and automation tools (database)", () => {
  it("get_analytics reports counts from the database", async () => {
    await prisma.task.create({ data: { title: "one" } });
    const result = (await getTool("get_analytics")!.run({ days: 7 } as never, context)) as { tasks: { totals: { created: number } } };
    expect(result.tasks.totals.created).toBe(1);
  });

  it("lists automations and their runs, and running one is a write that needs approval", async () => {
    const flow = await prisma.workflow.create({ data: { name: "Nightly", trigger: { type: "manual" }, steps: [] } });
    const list = (await getTool("list_automations")!.run({} as never, context)) as { automations: { id: string; name: string }[] };
    expect(list.automations.map((a) => a.name)).toEqual(["Nightly"]);
    const outcome = (await getTool("run_automation")!.run({ automationId: flow.id } as never, context)) as { runId: string };
    const runs = (await getTool("get_automation_runs")!.run({ automationId: flow.id } as never, context)) as { runs: { id: string }[] };
    expect(runs.runs.map((r) => r.id)).toEqual([outcome.runId]);
    expect(getTool("run_automation")!.risk).toBe("write");
    const agent = BUILT_IN_AGENTS.find((a) => a.key === "automation-agent")!;
    expect(approvalFor(agent.tools)).toContain("run_automation");
  });

  it("the Data Analyst can only read", () => {
    const agent = BUILT_IN_AGENTS.find((a) => a.key === "data-analyst")!;
    for (const name of agent.tools) expect(getTool(name)?.risk, name).toBe("read");
  });
});
