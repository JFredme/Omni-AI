import { errorResponse, readBody } from "@/lib/api-route";
import { updateWorkflowSchema } from "@/lib/automations/schemas";
import { deleteWorkflow, getWorkflow, listRuns, updateWorkflow } from "@/lib/automations/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const [workflow, runs] = await Promise.all([getWorkflow(id), listRuns(id, 20)]);
    return Response.json({ workflow, runs });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return Response.json({ workflow: await updateWorkflow((await params).id, await readBody(request, updateWorkflowSchema)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteWorkflow((await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
