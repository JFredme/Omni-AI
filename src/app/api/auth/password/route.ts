import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { changePassword } from "@/lib/auth/service";
import { deleteOtherSessions, readSessionCookie } from "@/lib/auth/session";

const schema = z.object({ currentPassword: z.string().max(500), newPassword: z.string().max(500) });

/** Changes the password and signs every other browser out. */
export async function POST(request: Request) {
  try {
    const { currentPassword, newPassword } = await readBody(request, schema);
    await changePassword(currentPassword, newPassword);
    const signedOut = await deleteOtherSessions(readSessionCookie(request));
    return Response.json({ ok: true, signedOutOtherBrowsers: signedOut });
  } catch (error) {
    return errorResponse(error);
  }
}
