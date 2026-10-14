import { errorResponse } from "@/lib/api-route";
import { getNotesMeta } from "@/lib/notes/service";

export async function GET() {
  try {
    return Response.json(await getNotesMeta());
  } catch (error) {
    return errorResponse(error);
  }
}
