import { errorResponse, readBody } from "@/lib/api-route";
import { updateNoteSchema } from "@/lib/notes/schemas";
import { deleteNote, getNote, updateNote } from "@/lib/notes/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json({ note: await getNote(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const patch = await readBody(request, updateNoteSchema);
    return Response.json({ note: await updateNote(id, patch) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await deleteNote(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
