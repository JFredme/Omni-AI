import { errorResponse, readBody } from "@/lib/api-route";
import { launchRun, startRun } from "@/lib/agents/engine";
import { getRun, listRuns } from "@/lib/agents/runs";
import { startRunSchema } from "@/lib/agents/schemas";

export async function GET(request: Request) {
  try {
    const agentId = new URL(request.url).searchParams.get("agentId") ?? undefined;
    return Response.json({ runs: await listRuns({ agentId }) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Starts a run in the background and returns immediately; poll the run for progress. */
export async function POST(request: Request) {
  try {
    const input = await readBody(request, startRunSchema);
    const run = await startRun(input);
    launchRun(run.id);
    return Response.json({ run: await getRun(run.id) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
