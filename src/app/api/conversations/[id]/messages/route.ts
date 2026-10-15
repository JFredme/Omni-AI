import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { MAX_USER_MESSAGE_CHARS, prepareSend } from "@/lib/chat/service";
import { turnStreamResponse } from "@/lib/chat/stream";

const sendSchema = z.object({
  content: z.string().max(MAX_USER_MESSAGE_CHARS * 2),
  modelId: z.string().trim().min(1).max(200).optional(),
  useKnowledge: z.boolean().optional(),
  web: z.enum(["auto", "on", "off"]).optional(),
  attachmentIds: z.array(z.string().max(60)).max(10).optional(),
  replaceMessageId: z.string().max(60).optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = await readBody(request, sendSchema);
    const plan = await prepareSend(id, input, request.signal);
    return turnStreamResponse(plan, request.signal);
  } catch (error) {
    return errorResponse(error);
  }
}
