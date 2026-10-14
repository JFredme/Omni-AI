import { errorResponse, readBody } from "@/lib/api-route";
import { updateTaskSchema } from "@/lib/tasks/schemas";
import { deleteTask, getTask, updateTask } from "@/lib/tasks/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json({ task: await getTask(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const patch = await readBody(request, updateTaskSchema);
    return Response.json({ task: await updateTask(id, patch) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await deleteTask(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
