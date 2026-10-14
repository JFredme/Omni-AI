import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import {
  deleteConversation,
  getConversation,
  MAX_SYSTEM_PROMPT_CHARS,
  MAX_TITLE_CHARS,
  updateConversation,
} from "@/lib/chat/service";

const patchSchema = z.object({
  title: z.string().max(MAX_TITLE_CHARS).optional(),
  modelId: z.string().trim().min(1).max(200).nullable().optional(),
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_CHARS).nullable().optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json({ conversation: await getConversation(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const patch = await readBody(request, patchSchema);
    await updateConversation(id, patch);
    return Response.json({ conversation: await getConversation(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await deleteConversation(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
