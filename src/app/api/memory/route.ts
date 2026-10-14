import { ApiError } from "@/lib/api-error";
import { errorResponse, readBody } from "@/lib/api-route";
import { clearMemories, createMemory, listMemories } from "@/lib/knowledge/memory";
import { memorySchema } from "@/lib/knowledge/schemas";

export async function GET() {
  try {
    return Response.json({ memories: await listMemories() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { content } = await readBody(request, memorySchema);
    return Response.json({ memory: await createMemory({ content }) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Deletes every memory. Requires `?confirm=all` so it can't happen by accident. */
export async function DELETE(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("confirm") !== "all") {
      throw new ApiError(400, "confirmation_required", "Add ?confirm=all to delete every memory.");
    }
    return Response.json({ deleted: await clearMemories() });
  } catch (error) {
    return errorResponse(error);
  }
}
