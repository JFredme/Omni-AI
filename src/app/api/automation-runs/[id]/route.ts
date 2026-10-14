import { errorResponse } from "@/lib/api-route";
import { getRun } from "@/lib/automations/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ run: await getRun((await params).id) });
  } catch (error) {
    return errorResponse(error);
  }
}
