import { errorResponse, readBody } from "@/lib/api-route";
import { isDateKey } from "@/lib/dates";
import { createTaskSchema, parseTaskFilters } from "@/lib/tasks/schemas";
import { createTask, listTasks } from "@/lib/tasks/service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = parseTaskFilters(searchParams);
    const today = searchParams.get("today");
    return Response.json({ tasks: await listTasks(filters, today && isDateKey(today) ? today : undefined) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readBody(request, createTaskSchema);
    return Response.json({ task: await createTask(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
