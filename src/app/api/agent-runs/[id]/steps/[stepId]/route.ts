import { errorResponse, readBody } from "@/lib/api-route";
import { decideStep } from "@/lib/agents/engine";
import { getRun } from "@/lib/agents/runs";
import { decisionSchema } from "@/lib/agents/schemas";

type Context = { params: Promise<{ id: string; stepId: string }> };

/** Approve or decline the action a paused run is waiting on. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id, stepId } = await params;
    const { decision } = await readBody(request, decisionSchema);
    await decideStep(id, stepId, decision);
    return Response.json({ run: await getRun(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
