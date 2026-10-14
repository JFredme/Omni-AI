import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, isApiPath, SESSION_COOKIE } from "@/lib/auth/guard";
import { validateSession } from "@/lib/auth/session";
import { hit } from "@/lib/rate-limit";

// Requests that spend money on the model get a tighter limit than everything else.
const EXPENSIVE = [/^\/api\/conversations\/[^/]+\/(messages|regenerate)$/, /^\/api\/ai\/(propose|apply)$/, /^\/api\/agent-runs$/];

function json(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  let hasSession = false;
  try {
    hasSession = await validateSession(token);
  } catch (error) {
    console.error("Could not check the session:", error);
    return isApiPath(pathname) ? json(503, "unavailable", "The database is not reachable.") : new NextResponse("The database is not reachable. Check that PostgreSQL is running.", { status: 503 });
  }

  const decision = decideAccess({
    pathname,
    search,
    method: request.method,
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    hasSession,
  });

  if (decision.kind === "forbidden") return json(403, "cross_site", decision.reason);
  if (decision.kind === "unauthorized") return json(401, "unauthorized", "Sign in to continue.");
  if (decision.kind === "login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = decision.next === "/" ? "" : `?next=${encodeURIComponent(decision.next)}`;
    return NextResponse.redirect(url);
  }

  if (hasSession && isApiPath(pathname) && request.method !== "GET" && request.method !== "HEAD") {
    const key = token!.slice(0, 16);
    const expensive = request.method === "POST" && EXPENSIVE.some((pattern) => pattern.test(pathname));
    const general = hit(`api:${key}`, 600, 60_000);
    const spending = expensive ? hit(`ai:${key}`, 40, 60_000) : null;
    const blocked = !general.allowed ? general : spending && !spending.allowed ? spending : null;
    if (blocked) {
      return json(429, "rate_limited", "You're sending requests too quickly. Wait a moment and try again.", { "Retry-After": String(blocked.retryAfterSeconds) });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)"],
};
