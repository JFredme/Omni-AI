import { errorResponse } from "@/lib/api-route";
import { getUsageSummary } from "@/lib/usage";

export async function GET() {
  try {
    return Response.json(await getUsageSummary());
  } catch (error) {
    return errorResponse(error);
  }
}
