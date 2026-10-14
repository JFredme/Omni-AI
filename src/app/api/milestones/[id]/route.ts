import { errorResponse, readBody } from "@/lib/api-route";
import { updateMilestoneSchema } from "@/lib/projects/schemas";
import { deleteMilestone, updateMilestone } from "@/lib/projects/service";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const patch = await readBody(request, updateMilestoneSchema);
    return Response.json({ milestone: await updateMilestone(id, patch) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await deleteMilestone(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
