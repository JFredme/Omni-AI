import { errorResponse } from "@/lib/api-route";
import { listRuns } from "@/lib/automations/service";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return Response.json({ runs: await listRuns(params.get("workflowId"), Number(params.get("limit")) || 30) });
  } catch (error) {
    return errorResponse(error);
  }
}
