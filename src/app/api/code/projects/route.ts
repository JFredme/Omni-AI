import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { createProject, listProjects } from "@/lib/code/service";

export async function GET() {
  try {
    return Response.json({ projects: await listProjects() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { name } = await readBody(request, z.object({ name: z.string().max(200) }));
    return Response.json({ project: await createProject(name) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
