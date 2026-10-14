import { errorResponse } from "@/lib/api-route";
import { googleClient } from "@/lib/integrations/providers/google";
import { redirectUriFor } from "@/lib/integrations/connect";
import { listConnections } from "@/lib/integrations/connections";

export async function GET(request: Request) {
  try {
    return Response.json({ connections: await listConnections(), googleRedirectUri: redirectUriFor(request), googleConfigured: googleClient() !== null });
  } catch (error) {
    return errorResponse(error);
  }
}
