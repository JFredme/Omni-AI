import { errorResponse } from "@/lib/api-route";
import { loginRequired } from "@/lib/auth/guard";
import { isConfigured } from "@/lib/auth/service";
import { readSessionCookie, validateSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    if (!loginRequired()) return Response.json({ loginRequired: false, configured: true, authenticated: true });
    const [configured, authenticated] = await Promise.all([isConfigured(), validateSession(readSessionCookie(request))]);
    return Response.json({ loginRequired: true, configured, authenticated });
  } catch (error) {
    return errorResponse(error);
  }
}
