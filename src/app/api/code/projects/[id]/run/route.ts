import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { errorResponse, readBody } from "@/lib/api-route";
import { runInSandbox, SandboxError } from "@/lib/code/sandbox";
import { projectFiles } from "@/lib/code/service";

type Context = { params: Promise<{ id: string }> };

/**
 * Runs one file of the project in a Docker sandbox (no network, read-only, limited memory and time). Only a person pressing
 * Run reaches this: nothing in the app, including agents and automations, calls it.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { entry } = await readBody(request, z.object({ entry: z.string().max(300) }));
    const files = await projectFiles((await params).id);
    if (!files.some((file) => file.path === entry)) throw new ApiError(404, "not_found", "That file isn't in this project.");
    const result = await runInSandbox({ files, entry, signal: request.signal });
    return Response.json({ result });
  } catch (error) {
    if (error instanceof SandboxError) {
      return Response.json({ error: { code: error.kind === "unavailable" ? "sandbox_unavailable" : "cannot_run", message: error.message } }, { status: error.kind === "unavailable" ? 503 : 400 });
    }
    return errorResponse(error);
  }
}
