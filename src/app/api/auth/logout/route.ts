import { errorResponse } from "@/lib/api-route";
import { audit } from "@/lib/auth/service";
import { clearedCookieHeader, deleteSession, isSecureRequest, readSessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    await deleteSession(readSessionCookie(request));
    await audit("auth.logout", "Signed out");
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedCookieHeader(isSecureRequest(request)) } });
  } catch (error) {
    return errorResponse(error);
  }
}
