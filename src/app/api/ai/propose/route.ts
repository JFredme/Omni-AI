import { errorResponse, readBody } from "@/lib/api-route";
import { propose } from "@/lib/ai/propose";
import { proposeSchema } from "@/lib/ai/schemas";

/** Asks the assistant for a proposal. Nothing is saved; the user confirms through /api/ai/apply. */
export async function POST(request: Request) {
  try {
    const input = await readBody(request, proposeSchema);
    return Response.json(await propose(input, request.signal));
  } catch (error) {
    return errorResponse(error);
  }
}
