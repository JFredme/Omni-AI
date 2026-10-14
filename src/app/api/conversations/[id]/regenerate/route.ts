import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { prepareRegenerate } from "@/lib/chat/service";
import { turnStreamResponse } from "@/lib/chat/stream";

const regenerateSchema = z.object({
  modelId: z.string().trim().min(1).max(200).optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = await readBody(request, regenerateSchema);
    const plan = await prepareRegenerate(id, input);
    return turnStreamResponse(plan, request.signal);
  } catch (error) {
    return errorResponse(error);
  }
}
