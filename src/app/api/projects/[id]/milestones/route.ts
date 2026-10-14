import { errorResponse, readBody } from "@/lib/api-route";
import { createMilestoneSchema } from "@/lib/projects/schemas";
import { createMilestone } from "@/lib/projects/service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = await readBody(request, createMilestoneSchema);
    return Response.json({ milestone: await createMilestone(id, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
