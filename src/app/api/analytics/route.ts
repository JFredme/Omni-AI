import { errorResponse } from "@/lib/api-route";
import { getAnalytics } from "@/lib/analytics/service";
import { RANGES } from "@/lib/analytics/types";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const requested = Number(params.get("days"));
    const days = (RANGES as readonly number[]).includes(requested) ? requested : 30;
    return Response.json({ analytics: await getAnalytics({ days, timeZone: params.get("tz") ?? undefined }) });
  } catch (error) {
    return errorResponse(error);
  }
}
