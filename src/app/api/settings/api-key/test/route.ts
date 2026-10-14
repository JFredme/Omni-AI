import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { fetchKeyInfo } from "@/lib/openrouter/client";
import { requireApiKey } from "@/lib/settings";

const testSchema = z.object({
  /** Optional key to test before saving. When omitted, the saved key is tested. */
  apiKey: z.string().trim().min(1).max(300).optional(),
});

export async function POST(request: Request) {
  try {
    const { apiKey } = await readBody(request, testSchema);
    const key = apiKey ?? (await requireApiKey()).key;
    const info = await fetchKeyInfo(key, request.signal);
    return Response.json({ ok: true, info });
  } catch (error) {
    return errorResponse(error);
  }
}
