import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { audit, setupPassword } from "@/lib/auth/service";
import { createSession, isSecureRequest, sessionCookieHeader } from "@/lib/auth/session";

const schema = z.object({ password: z.string() });

export async function POST(request: Request) {
  try {
    const { password } = await readBody(request, schema);
    await setupPassword(password);
    const { token, expiresAt } = await createSession(request.headers.get("user-agent"));
    await audit("auth.login", "Signed in after setup");
    return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": sessionCookieHeader(token, expiresAt, isSecureRequest(request)) } });
  } catch (error) {
    return errorResponse(error);
  }
}
