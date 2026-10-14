import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { errorResponse, readBody } from "@/lib/api-route";
import { PROVIDERS, type Provider } from "@/lib/integrations/catalog";
import { connectWithSecret, disconnect } from "@/lib/integrations/connect";
import { audit } from "@/lib/auth/service";

type Context = { params: Promise<{ provider: string }> };

async function providerOf(context: Context): Promise<Provider> {
  const { provider } = await context.params;
  if (!PROVIDERS.includes(provider as Provider)) throw new ApiError(404, "not_found", "That service isn't supported.");
  return provider as Provider;
}

/** Connects a token- or webhook-based service. The secret is checked with the service, then stored encrypted. */
export async function PUT(request: Request, context: Context) {
  try {
    const provider = await providerOf(context);
    const { secret } = await readBody(request, z.object({ secret: z.string().max(1_000) }));
    const result = await connectWithSecret(provider, secret, request.signal);
    await audit("integration.connected", provider);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const provider = await providerOf(context);
    await disconnect(provider);
    await audit("integration.disconnected", provider);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
