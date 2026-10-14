import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { scopeSchema, updateEventSchema } from "@/lib/calendar/schemas";
import { deleteEvent, getEvent, updateEvent } from "@/lib/calendar/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ event: await getEvent((await params).id) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Body: `{ patch, scope?, occurrence? }`. With scope "this" on a repeating event, only that date changes. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { patch, ...options } = await readBody(request, z.object({ patch: updateEventSchema }).extend(scopeSchema.shape));
    return Response.json({ event: await updateEvent((await params).id, patch, options) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const search = new URL(request.url).searchParams;
    const options = scopeSchema.parse({ scope: search.get("scope") ?? undefined, occurrence: search.get("occurrence") ?? undefined });
    await deleteEvent((await params).id, options);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
