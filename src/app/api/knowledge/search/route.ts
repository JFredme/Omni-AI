import { errorResponse, readBody } from "@/lib/api-route";
import { searchSchema } from "@/lib/knowledge/schemas";
import { searchKnowledge } from "@/lib/knowledge/service";

export async function POST(request: Request) {
  try {
    const { query, k, documentIds } = await readBody(request, searchSchema);
    return Response.json(await searchKnowledge(query, { k, documentIds, signal: request.signal }));
  } catch (error) {
    return errorResponse(error);
  }
}
