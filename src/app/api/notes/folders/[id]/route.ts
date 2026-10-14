import { errorResponse, readBody } from "@/lib/api-route";
import { folderSchema } from "@/lib/notes/schemas";
import { deleteFolder, renameFolder } from "@/lib/notes/service";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { name } = await readBody(request, folderSchema);
    return Response.json({ folder: await renameFolder(id, name) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await deleteFolder(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
