import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { hit, peek, reset } from "@/lib/rate-limit";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

const LOGIN_FAILURES = 8;
const LOGIN_WINDOW_MS = 15 * 60_000;

export async function isConfigured(): Promise<boolean> {
  return (await prisma.authConfig.count()) > 0;
}

export async function audit(action: string, detail?: string): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { action, detail: detail?.slice(0, 300) ?? null } });
  } catch (error) {
    console.error("Could not write the audit log:", error);
  }
}

/** Where the request came from, for rate limiting. Forwarded headers are trusted only when TRUST_PROXY=1. */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 64);
  }
  return "direct";
}

export async function setupPassword(password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new ApiError(400, "weak_password", problem);
  const passwordHash = await hashPassword(password);
  try {
    await prisma.authConfig.create({ data: { id: 1, passwordHash } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new ApiError(409, "already_configured", "A password is already set. Sign in instead.");
    }
    throw error;
  }
  await audit("auth.setup", "Password created");
}

export async function checkLogin(password: string, key: string): Promise<void> {
  const limitKey = `login:${key}`;
  const state = peek(limitKey, LOGIN_FAILURES, LOGIN_WINDOW_MS);
  if (!state.allowed) {
    await audit("auth.login_blocked", "Too many failed attempts");
    throw new ApiError(429, "too_many_attempts", `Too many failed sign-in attempts. Try again in ${Math.ceil(state.retryAfterSeconds / 60)} minute(s).`);
  }
  const config = await prisma.authConfig.findUnique({ where: { id: 1 } });
  if (!config) throw new ApiError(409, "not_configured", "No password is set yet. Create one first.");
  if (!(await verifyPassword(password, config.passwordHash))) {
    hit(limitKey, LOGIN_FAILURES, LOGIN_WINDOW_MS);
    await audit("auth.login_failed", "Wrong password");
    throw new ApiError(401, "invalid_credentials", "That password is incorrect.");
  }
  reset(limitKey);
}

export async function changePassword(current: string, next: string): Promise<void> {
  const config = await prisma.authConfig.findUnique({ where: { id: 1 } });
  if (!config) throw new ApiError(409, "not_configured", "No password is set yet.");
  if (!(await verifyPassword(current, config.passwordHash))) {
    await audit("auth.password_change_failed", "Wrong current password");
    throw new ApiError(401, "invalid_credentials", "The current password is incorrect.");
  }
  const problem = passwordProblem(next);
  if (problem) throw new ApiError(400, "weak_password", problem);
  await prisma.authConfig.update({ where: { id: 1 }, data: { passwordHash: await hashPassword(next) } });
  await audit("auth.password_changed", "Password changed");
}
