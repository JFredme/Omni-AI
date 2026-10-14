import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "./guard";

export const SESSION_DAYS = 30;
const TOUCH_AFTER_MS = 5 * 60_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userAgent: string | null, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await prisma.authSession.create({
    data: { tokenHash: hashToken(token), userAgent: userAgent?.slice(0, 300) ?? null, expiresAt, createdAt: now, lastUsedAt: now },
  });
  return { token, expiresAt };
}

/** True when the token belongs to a live session. Also records activity, at most every few minutes. */
export async function validateSession(token: string | undefined, now: Date = new Date()): Promise<boolean> {
  if (!token || token.length < 20 || token.length > 200) return false;
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, expiresAt: true, lastUsedAt: true } });
  if (!session) return false;
  if (session.expiresAt <= now) {
    await prisma.authSession.deleteMany({ where: { id: session.id } });
    return false;
  }
  if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
    await prisma.authSession.updateMany({ where: { id: session.id }, data: { lastUsedAt: now } });
  }
  return true;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Signs out every browser except the one holding `keepToken` (or all of them when it is omitted). */
export async function deleteOtherSessions(keepToken?: string): Promise<number> {
  const result = await prisma.authSession.deleteMany({ where: keepToken ? { tokenHash: { not: hashToken(keepToken) } } : {} });
  return result.count;
}

export async function purgeExpiredSessions(now: Date = new Date()): Promise<void> {
  await prisma.authSession.deleteMany({ where: { expiresAt: { lte: now } } });
}

export async function listSessions(currentToken: string | undefined, now: Date = new Date()) {
  const current = currentToken ? hashToken(currentToken) : null;
  const rows = await prisma.authSession.findMany({ where: { expiresAt: { gt: now } }, orderBy: { lastUsedAt: "desc" }, take: 50 });
  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    current: row.tokenHash === current,
  }));
}

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookieHeader(token: string, expiresAt: Date, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearedCookieHeader(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}
