import { errorResponse } from "@/lib/api-route";
import { rotateWebhookToken } from "@/lib/automations/service";

type Context = { params: Promise<{ id: string }> };

/** Creates a new secret address for this automation, replacing the old one. The secret is shown only in this response. */
export async function POST(_request: Request, { params }: Context) {
  try {
    return Response.json(await rotateWebhookToken((await params).id), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
