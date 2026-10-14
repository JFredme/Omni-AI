import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api-error";
import { audit } from "@/lib/auth/service";
import { finishGoogleSignIn } from "@/lib/integrations/connect";

/** Where Google sends you back. Success and failure both end on the Integrations page, with a short message. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const back = new URL("/integrations", process.env.OMNI_PUBLIC_URL || request.url);
  try {
    const { account } = await finishGoogleSignIn(request, { code: params.get("code"), state: params.get("state"), error: params.get("error") });
    await audit("integration.connected", "google");
    back.searchParams.set("connected", "google");
    back.searchParams.set("account", account);
  } catch (error) {
    back.searchParams.set("error", error instanceof ApiError ? error.message : "Couldn't connect Google.");
  }
  return NextResponse.redirect(back);
}
