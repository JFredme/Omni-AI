import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { audit, checkLogin, clientKey } from "@/lib/auth/service";
import { createSession, isSecureRequest, purgeExpiredSessions, sessionCookieHeader } from "@/lib/auth/session";

const schema = z.object({ password: z.string().max(500) });

export async function POST(request: Request) {
  try {
    const { password } = await readBody(request, schema);
    await checkLogin(password, clientKey(request));
    const { token, expiresAt } = await createSession(request.headers.get("user-agent"));
    await audit("auth.login", "Signed in");
    void purgeExpiredSessions().catch(() => undefined);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookieHeader(token, expiresAt, isSecureRequest(request)) } });
  } catch (error) {
    return errorResponse(error);
  }
}
