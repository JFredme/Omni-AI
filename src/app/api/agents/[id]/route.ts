import { errorResponse, readBody } from "@/lib/api-route";
import { updateAgentSchema } from "@/lib/agents/schemas";
import { deleteAgent, getAgent, updateAgent } from "@/lib/agents/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json({ agent: await getAgent(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const patch = await readBody(request, updateAgentSchema);
    return Response.json({ agent: await updateAgent(id, patch) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await deleteAgent(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
