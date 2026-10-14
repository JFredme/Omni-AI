import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { createConversation, listConversations, MAX_TITLE_CHARS } from "@/lib/chat/service";

const createSchema = z.object({
  title: z.string().max(MAX_TITLE_CHARS).optional(),
  modelId: z.string().trim().min(1).max(200).nullable().optional(),
});

export async function GET() {
  try {
    return Response.json({ conversations: await listConversations() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readBody(request, createSchema);
    const conversation = await createConversation({
      title: input.title,
      modelId: input.modelId ?? undefined,
    });
    return Response.json({ conversation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
