import { errorResponse, readBody } from "@/lib/api-route";
import { deleteMemory, updateMemory } from "@/lib/knowledge/memory";
import { memorySchema } from "@/lib/knowledge/schemas";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { content } = await readBody(request, memorySchema);
    return Response.json({ memory: await updateMemory((await params).id, content) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteMemory((await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
