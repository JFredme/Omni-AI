/** Pure access rules, kept separate from the proxy so they can be unit tested. */

export const SESSION_COOKIE = "omni_session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/status", "/api/auth/login", "/api/auth/setup"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "login"; next: string }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; reason: string };

/** Webhook addresses carry their own secret, so they don't need a browser session. */
export const WEBHOOK_PREFIX = "/api/hooks/";

export function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith(WEBHOOK_PREFIX) && pathname.length > WEBHOOK_PREFIX.length && !pathname.slice(WEBHOOK_PREFIX.length).includes("/");
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || isWebhookPath(pathname);
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * A browser always sends `Origin` on cross-site POST/PUT/PATCH/DELETE. When it is present it must match the host the
 * request was addressed to; a missing Origin (curl, server-to-server) is allowed because it can't come from another site.
 */
export function originProblem(method: string, origin: string | null, host: string | null): string | null {
  if (SAFE_METHODS.has(method.toUpperCase()) || !origin) return null;
  try {
    return new URL(origin).host === host ? null : "Cross-site requests are not allowed.";
  } catch {
    return "Cross-site requests are not allowed.";
  }
}

export function decideAccess(input: {
  pathname: string;
  search?: string;
  method: string;
  origin: string | null;
  host: string | null;
  hasSession: boolean;
}): AccessDecision {
  // Webhooks are called by other services, not by this site's pages, so a mismatched Origin says nothing about them.
  if (isWebhookPath(input.pathname)) return { kind: "allow" };
  const problem = isApiPath(input.pathname) || isPublicPath(input.pathname) ? originProblem(input.method, input.origin, input.host) : null;
  if (problem) return { kind: "forbidden", reason: problem };
  if (isPublicPath(input.pathname) || input.hasSession) return { kind: "allow" };
  if (isApiPath(input.pathname)) return { kind: "unauthorized" };
  const next = `${input.pathname}${input.search ?? ""}`;
  return { kind: "login", next: next.startsWith("/") && !next.startsWith("//") ? next : "/" };
}

/** Where to go after signing in. Only same-site paths are accepted, so this can't become an open redirect. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/**
 * Sign-in is off unless OMNI_REQUIRE_LOGIN=1. That suits an app on your own computer; turn it on before the app can be
 * reached by anyone else (a server, a shared network, Docker published beyond this machine).
 */
export function loginRequired(): boolean {
  return process.env.OMNI_REQUIRE_LOGIN === "1";
}
