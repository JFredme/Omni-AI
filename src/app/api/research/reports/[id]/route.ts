import { errorResponse } from "@/lib/api-route";
import { deleteReport, getReport } from "@/lib/research/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ report: await getReport((await params).id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteReport((await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
