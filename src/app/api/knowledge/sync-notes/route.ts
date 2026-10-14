import { errorResponse } from "@/lib/api-route";
import { syncNotes } from "@/lib/knowledge/service";

export async function POST() {
  try {
    return Response.json(await syncNotes());
  } catch (error) {
    return errorResponse(error);
  }
}
