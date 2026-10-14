import { errorResponse, readBody } from "@/lib/api-route";
import { isDateKey } from "@/lib/dates";
import { updateProjectSchema } from "@/lib/projects/schemas";
import { deleteProject, getProject, updateProject } from "@/lib/projects/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const today = new URL(request.url).searchParams.get("today");
    return Response.json({ project: await getProject(id, today && isDateKey(today) ? today : undefined) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const patch = await readBody(request, updateProjectSchema);
    return Response.json({ project: await updateProject(id, patch) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await deleteProject(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
