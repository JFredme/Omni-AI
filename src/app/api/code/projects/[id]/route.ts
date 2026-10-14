import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { deleteProject, renameProject } from "@/lib/code/service";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { name } = await readBody(request, z.object({ name: z.string().max(200) }));
    await renameProject((await params).id, name);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteProject((await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
