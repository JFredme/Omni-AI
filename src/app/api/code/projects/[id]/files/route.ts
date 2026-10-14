import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { createFile, listFiles } from "@/lib/code/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ files: await listFiles((await params).id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { path, content } = await readBody(request, z.object({ path: z.string().max(300), content: z.string().max(1_000_000).default("") }));
    return Response.json({ file: await createFile((await params).id, path, content) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
