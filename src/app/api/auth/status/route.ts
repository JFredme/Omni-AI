import { errorResponse } from "@/lib/api-route";
import { loginRequired } from "@/lib/auth/guard";
import { isConfigured } from "@/lib/auth/service";
import { readSessionCookie, validateSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    // Reading the request makes this answer per visit; otherwise it is built once and the setting would be frozen at build time.
    const cookie = readSessionCookie(request);
    if (!loginRequired()) return Response.json({ loginRequired: false, configured: true, authenticated: true });
    const [configured, authenticated] = await Promise.all([isConfigured(), validateSession(cookie)]);
    return Response.json({ loginRequired: true, configured, authenticated });
  } catch (error) {
    return errorResponse(error);
  }
}
