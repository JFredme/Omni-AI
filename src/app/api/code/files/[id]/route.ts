import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { deleteFile, getFile, renameFile, saveFile } from "@/lib/code/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ file: await getFile((await params).id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { content } = await readBody(request, z.object({ content: z.string().max(1_000_000) }));
    return Response.json({ file: await saveFile((await params).id, content) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { path } = await readBody(request, z.object({ path: z.string().max(300) }));
    return Response.json({ file: await renameFile((await params).id, path) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteFile((await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
