import { ApiError } from "@/lib/api-error";
import { errorResponse, readBody } from "@/lib/api-route";
import { isThisComputer } from "@/lib/computer/local";
import { prisma } from "@/lib/db";
import { decideStep } from "@/lib/agents/engine";
import { getRun } from "@/lib/agents/runs";
import { decisionSchema } from "@/lib/agents/schemas";

type Context = { params: Promise<{ id: string; stepId: string }> };

/** Approve or decline the action a paused run is waiting on. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id, stepId } = await params;
    const { decision } = await readBody(request, decisionSchema);
    if (decision === "approve" && !isThisComputer(request)) {
      // Approving an action on this computer has to be done on this computer, so a phone on the Wi-Fi can't do it.
      const step = await prisma.agentStep.findFirst({ where: { id: stepId, runId: id }, select: { tool: true } });
      const { getTool } = await import("@/lib/agents/tools");
      if (step?.tool && getTool(step.tool)?.risk === "computer") {
        throw new ApiError(403, "local_only", "Actions on the computer can only be approved on the computer itself. Open Omni there to approve this.");
      }
    }
    await decideStep(id, stepId, decision);
    return Response.json({ run: await getRun(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
