import { errorResponse, readBody } from "@/lib/api-route";
import { createWorkflowSchema } from "@/lib/automations/schemas";
import { createWorkflow, listWorkflows } from "@/lib/automations/service";

export async function GET() {
  try {
    return Response.json({ workflows: await listWorkflows() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json({ workflow: await createWorkflow(await readBody(request, createWorkflowSchema)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
