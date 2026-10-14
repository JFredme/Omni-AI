import { errorResponse } from "@/lib/api-route";
import { getModelCatalog } from "@/lib/openrouter/catalog";
import { resolveApiKey } from "@/lib/settings";

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const resolved = await resolveApiKey();
    const catalog = await getModelCatalog({ apiKey: resolved?.key ?? null, refresh });
    return Response.json({
      models: catalog.models,
      fetchedAt: new Date(catalog.fetchedAt).toISOString(),
      cached: catalog.cached,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
