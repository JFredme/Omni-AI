import { errorResponse } from "@/lib/api-route";
import { getDashboard } from "@/lib/dashboard";
import { isDateKey } from "@/lib/dates";

export async function GET(request: Request) {
  try {
    const today = new URL(request.url).searchParams.get("today");
    return Response.json({ dashboard: await getDashboard(today && isDateKey(today) ? today : undefined) });
  } catch (error) {
    return errorResponse(error);
  }
}
