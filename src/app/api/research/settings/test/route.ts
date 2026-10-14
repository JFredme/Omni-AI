import { errorResponse } from "@/lib/api-route";
import { webSearch } from "@/lib/research/providers";
import { resolveSearchConfig } from "@/lib/research/settings";

/** Runs one real search so you can tell whether the provider and key work. */
export async function POST(request: Request) {
  try {
    const results = await webSearch(await resolveSearchConfig(), "weather", { count: 1, signal: request.signal });
    return Response.json({ ok: true, results: results.length });
  } catch (error) {
    return errorResponse(error);
  }
}
