import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { selectBranch } from "@/lib/chat/service";

type Context = { params: Promise<{ id: string }> };

/** Switches the conversation to the branch containing the given message. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { messageId } = await readBody(request, z.object({ messageId: z.string().min(1).max(60) }));
    await selectBranch((await params).id, messageId);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
