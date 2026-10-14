import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { GENERATE_KINDS, generate } from "@/lib/documents/generate";

const schema = z.object({ kind: z.enum(GENERATE_KINDS), prompt: z.string().max(4_000), noteId: z.string().max(60).optional() });

export async function POST(request: Request) {
  try {
    const input = await readBody(request, schema);
    return Response.json(await generate({ ...input, signal: request.signal }));
  } catch (error) {
    return errorResponse(error);
  }
}
