import { errorResponse, readBody } from "@/lib/api-route";
import { applyProposal } from "@/lib/ai/apply";
import { applySchema } from "@/lib/ai/schemas";

/** Saves the parts of a proposal the user confirmed. The payload is validated like any other write. */
export async function POST(request: Request) {
  try {
    const input = await readBody(request, applySchema);
    return Response.json(await applyProposal(input));
  } catch (error) {
    return errorResponse(error);
  }
}
