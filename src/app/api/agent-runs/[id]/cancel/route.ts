import { errorResponse } from "@/lib/api-route";
import { cancelRun } from "@/lib/agents/engine";
import { getRun } from "@/lib/agents/runs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await getRun(id);
    await cancelRun(id);
    return Response.json({ run: await getRun(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
