import { errorResponse } from "@/lib/api-route";
import { audit } from "@/lib/auth/service";
import { deleteOtherSessions, listSessions, readSessionCookie } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    return Response.json({ sessions: await listSessions(readSessionCookie(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Signs out every other browser. */
export async function DELETE(request: Request) {
  try {
    const count = await deleteOtherSessions(readSessionCookie(request));
    await audit("auth.sessions_revoked", `${count} other session(s) signed out`);
    return Response.json({ signedOut: count });
  } catch (error) {
    return errorResponse(error);
  }
}
