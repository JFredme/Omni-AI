import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { deleteDocument, getDocument, updateDocumentTags } from "@/lib/knowledge/service";
import { tagsSchema } from "@/lib/tags";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json(await getDocument((await params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { tags } = await readBody(request, z.object({ tags: tagsSchema }));
    return Response.json({ document: await updateDocumentTags((await params).id, tags) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteDocument((await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
