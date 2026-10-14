import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api-route";
import { GOOGLE_SCOPE_SETS } from "@/lib/integrations/catalog";
import { startGoogleSignIn } from "@/lib/integrations/connect";

/** Sends you to Google to sign in. Reading is the default; email drafts must be asked for. */
export async function GET(request: Request) {
  try {
    const scope = z.enum(Object.keys(GOOGLE_SCOPE_SETS) as ["read", "drafts"]).catch("read").parse(new URL(request.url).searchParams.get("scope"));
    return NextResponse.redirect(await startGoogleSignIn(request, scope));
  } catch (error) {
    return errorResponse(error);
  }
}
