import { errorResponse } from "@/lib/api-route";
import { getRun } from "@/lib/agents/runs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json({ run: await getRun(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
