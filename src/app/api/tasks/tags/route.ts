import { errorResponse } from "@/lib/api-route";
import { listTaskTags } from "@/lib/tasks/service";

export async function GET() {
  try {
    return Response.json({ tags: await listTaskTags() });
  } catch (error) {
    return errorResponse(error);
  }
}
