import { errorResponse, readBody } from "@/lib/api-route";
import { isDateKey } from "@/lib/dates";
import { createProjectSchema } from "@/lib/projects/schemas";
import { createProject, listProjects } from "@/lib/projects/service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const today = searchParams.get("today");
    const projects = await listProjects(
      { includeArchived: searchParams.get("archived") === "1" },
      today && isDateKey(today) ? today : undefined,
    );
    return Response.json({ projects });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readBody(request, createProjectSchema);
    return Response.json({ project: await createProject(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
