import { errorResponse } from "@/lib/api-route";
import { runWorkflow } from "@/lib/automations/engine";
import { getRun } from "@/lib/automations/service";

type Context = { params: Promise<{ id: string }> };

/** Runs the automation right now and returns what happened, step by step. */
export async function POST(_request: Request, { params }: Context) {
  try {
    const outcome = await runWorkflow((await params).id, { type: "manual", data: {} });
    return Response.json({ run: await getRun(outcome.runId) });
  } catch (error) {
    return errorResponse(error);
  }
}
