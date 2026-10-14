import { errorResponse, readBody } from "@/lib/api-route";
import { folderSchema } from "@/lib/notes/schemas";
import { createFolder } from "@/lib/notes/service";

export async function POST(request: Request) {
  try {
    const { name } = await readBody(request, folderSchema);
    return Response.json({ folder: await createFolder(name) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
