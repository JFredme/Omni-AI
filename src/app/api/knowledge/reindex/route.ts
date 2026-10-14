import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { reindex } from "@/lib/knowledge/service";

export async function POST(request: Request) {
  try {
    const { documentId } = await readBody(request, z.object({ documentId: z.string().max(60).optional() }));
    return Response.json({ queued: await reindex(documentId) });
  } catch (error) {
    return errorResponse(error);
  }
}
