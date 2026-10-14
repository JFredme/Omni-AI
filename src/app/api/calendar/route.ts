import { errorResponse, readBody } from "@/lib/api-route";
import { createEventSchema, rangeSchema } from "@/lib/calendar/schemas";
import { createEvent, listRange } from "@/lib/calendar/service";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { from, to } = rangeSchema.parse({ from: params.get("from"), to: params.get("to") });
    return Response.json(await listRange(new Date(from), new Date(to)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json({ event: await createEvent(await readBody(request, createEventSchema)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
