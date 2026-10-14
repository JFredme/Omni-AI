import { errorResponse, readBody } from "@/lib/api-route";
import { createNoteSchema, parseNoteFilters } from "@/lib/notes/schemas";
import { createNote, listNotes } from "@/lib/notes/service";

export async function GET(request: Request) {
  try {
    const filters = parseNoteFilters(new URL(request.url).searchParams);
    return Response.json({ notes: await listNotes(filters) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readBody(request, createNoteSchema);
    return Response.json({ note: await createNote(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
