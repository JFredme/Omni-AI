// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { clearAllLimits } from "@/lib/rate-limit";
import { assertTestDatabase } from "@/test/db-guard";
import { changePassword, checkLogin, isConfigured, setupPassword } from "./service";
import { createSession, deleteOtherSessions, deleteSession, listSessions, readSessionCookie, validateSession } from "./session";

beforeEach(async () => {
  assertTestDatabase();
  clearAllLimits();
  await prisma.authSession.deleteMany();
  await prisma.authConfig.deleteMany();
  await prisma.auditLog.deleteMany();
});

describe("password setup and login (database)", () => {
  it("sets the password once and never stores it in plain text", async () => {
    expect(await isConfigured()).toBe(false);
    await setupPassword("my private passphrase");
    expect(await isConfigured()).toBe(true);
    const stored = await prisma.authConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(stored.passwordHash).not.toContain("passphrase");
    await expect(setupPassword("another passphrase!!")).rejects.toMatchObject({ status: 409, code: "already_configured" });
    await checkLogin("my private passphrase", "test");
  });

  it("rejects weak passwords at setup", async () => {
    await expect(setupPassword("short")).rejects.toMatchObject({ status: 400, code: "weak_password" });
    expect(await isConfigured()).toBe(false);
  });

  it("locks out after repeated failures, even for the right password, then recovers on reset", async () => {
    await setupPassword("my private passphrase");
    for (let i = 0; i < 8; i++) await expect(checkLogin("wrong", "attacker")).rejects.toMatchObject({ status: 401 });
    await expect(checkLogin("my private passphrase", "attacker")).rejects.toMatchObject({ status: 429, code: "too_many_attempts" });
    // A different client is unaffected.
    await checkLogin("my private passphrase", "someone-else");
    const actions = (await prisma.auditLog.findMany()).map((row) => row.action);
    expect(actions).toContain("auth.login_failed");
    expect(actions).toContain("auth.login_blocked");
  });

  it("never writes a password into the audit log", async () => {
    await setupPassword("my private passphrase");
    await expect(checkLogin("hunter2-secret-guess", "k")).rejects.toThrow();
    const text = JSON.stringify(await prisma.auditLog.findMany());
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("my private passphrase");
  });

  it("changes the password only with the current one", async () => {
    await setupPassword("my private passphrase");
    await expect(changePassword("nope nope nope", "a brand new passphrase")).rejects.toMatchObject({ status: 401 });
    await changePassword("my private passphrase", "a brand new passphrase");
    await expect(checkLogin("my private passphrase", "k2")).rejects.toMatchObject({ status: 401 });
    await checkLogin("a brand new passphrase", "k2");
  });
});

describe("sessions (database)", () => {
  it("accepts a fresh token, stores only its hash, and rejects unknown tokens", async () => {
    const { token } = await createSession("Mozilla/5.0 (Macintosh; Mac OS X) Chrome/120");
    expect(await validateSession(token)).toBe(true);
    expect(await validateSession(`${token}x`)).toBe(false);
    expect(await validateSession(undefined)).toBe(false);
    const row = await prisma.authSession.findFirstOrThrow();
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("expires sessions", async () => {
    const past = new Date(Date.now() - 31 * 86_400_000);
    const { token } = await createSession(null, past);
    expect(await validateSession(token)).toBe(false);
    expect(await prisma.authSession.count()).toBe(0);
  });

  it("signs out one browser, or all the others", async () => {
    const a = await createSession("a");
    const b = await createSession("b");
    const c = await createSession("c");
    await deleteSession(a.token);
    expect(await validateSession(a.token)).toBe(false);
    expect(await deleteOtherSessions(b.token)).toBe(1);
    expect(await validateSession(b.token)).toBe(true);
    expect(await validateSession(c.token)).toBe(false);
    expect((await listSessions(b.token)).map((row) => row.current)).toEqual([true]);
  });
});

describe("cookie parsing", () => {
  it("reads the session cookie among others", () => {
    const request = new Request("http://x.test", { headers: { cookie: "theme=dark; omni_session=abc%2Fdef; other=1" } });
    expect(readSessionCookie(request)).toBe("abc/def");
    expect(readSessionCookie(new Request("http://x.test"))).toBeUndefined();
  });
});
