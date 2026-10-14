import { ApiError } from "@/lib/api-error";
import { errorResponse } from "@/lib/api-route";
import { PROVIDERS, type Provider } from "@/lib/integrations/catalog";
import { testConnection } from "@/lib/integrations/connect";

type Context = { params: Promise<{ provider: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { provider } = await params;
    if (!PROVIDERS.includes(provider as Provider)) throw new ApiError(404, "not_found", "That service isn't supported.");
    return Response.json(await testConnection(provider as Provider, request.signal));
  } catch (error) {
    return errorResponse(error);
  }
}
