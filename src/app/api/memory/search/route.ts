import { errorResponse, readBody } from "@/lib/api-route";
import { searchMemories } from "@/lib/knowledge/memory";
import { searchSchema } from "@/lib/knowledge/schemas";

export async function POST(request: Request) {
  try {
    const { query, k } = await readBody(request, searchSchema);
    return Response.json(await searchMemories(query, { k, signal: request.signal }));
  } catch (error) {
    return errorResponse(error);
  }
}
