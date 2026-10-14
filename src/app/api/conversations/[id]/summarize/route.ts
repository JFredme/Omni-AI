import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { summarizeConversation } from "@/lib/chat/summarize";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { modelId } = await readBody(request, z.object({ modelId: z.string().trim().min(1).max(200).optional() }));
    return Response.json({ summary: await summarizeConversation((await params).id, modelId) });
  } catch (error) {
    return errorResponse(error);
  }
}
