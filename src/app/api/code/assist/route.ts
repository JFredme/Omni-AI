import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { ASSIST_MODES, assist } from "@/lib/code/assist";

const schema = z.object({ fileId: z.string().min(1).max(60), mode: z.enum(ASSIST_MODES), instruction: z.string().max(2_000).default("") });

export async function POST(request: Request) {
  try {
    const input = await readBody(request, schema);
    return Response.json({ result: await assist({ ...input, signal: request.signal }) });
  } catch (error) {
    return errorResponse(error);
  }
}
