import { errorResponse } from "@/lib/api-route";
import { isConfigured } from "@/lib/auth/service";
import { readSessionCookie, validateSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const [configured, authenticated] = await Promise.all([isConfigured(), validateSession(readSessionCookie(request))]);
    return Response.json({ configured, authenticated });
  } catch (error) {
    return errorResponse(error);
  }
}
