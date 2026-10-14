// Sign-in, protected routes, and the password setup flow. Runs first on a fresh database, with no session.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const password = process.env.E2E_PASSWORD ?? "e2e-password-123";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, ok: false });
    console.log(`FAIL ${name}\n  ${error.message}`);
  }
}

try {
  await check("a signed-out visitor is sent to the login page, and the API refuses them", async () => {
    await page.goto(`${baseUrl}/tasks`);
    await page.waitForURL(/\/login\?next=%2Ftasks/);
    for (const path of ["/api/tasks", "/api/settings", "/api/agents", "/api/audit", "/api/dashboard"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401, `${path} should require sign-in`);
    }
    const write = await fetch(`${baseUrl}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x" }) });
    assert.equal(write.status, 401);
  });

  await check("first run asks for a password, and rejects a weak or mismatched one", async () => {
    await page.getByRole("heading", { name: "Set a password" }).waitFor();
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: "Create password" }).click();
    await page.getByRole("alert").getByText(/at least 10/).waitFor();
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill("something else entirely");
    await page.getByRole("button", { name: "Create password" }).click();
    await page.getByRole("alert").getByText(/don't match/).waitFor();
  });

  await check("creating a password signs you in and returns you to where you were going", async () => {
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create password" }).click();
    await page.waitForURL(`${baseUrl}/tasks`);
    await page.getByRole("heading", { name: "Tasks", level: 1 }).waitFor();
    const cookie = (await context.cookies()).find((c) => c.name === "omni_session");
    assert.ok(cookie, "session cookie is set");
    assert.equal(cookie.httpOnly, true, "the cookie is not readable by page scripts");
    assert.equal(cookie.sameSite, "Lax");
  });

  await check("setup can't be run a second time", async () => {
    const response = await fetch(`${baseUrl}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "another-password-1" }) });
    assert.equal(response.status, 409);
  });

  await check("cross-site writes are refused even with a valid session", async () => {
    const cookie = (await context.cookies()).find((c) => c.name === "omni_session");
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `omni_session=${cookie.value}`, Origin: "https://evil.example" },
      body: JSON.stringify({ title: "forged" }),
    });
    assert.equal(response.status, 403);
  });

  await check("signing out ends the session everywhere it was used", async () => {
    const token = (await context.cookies()).find((c) => c.name === "omni_session").value;
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    const stale = await fetch(`${baseUrl}/api/tasks`, { headers: { Cookie: `omni_session=${token}` } });
    assert.equal(stale.status, 401, "the old cookie no longer works");
  });

  await check("a wrong password is rejected, the right one signs in", async () => {
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("alert").getByText(/incorrect/).waitFor();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
  });

  await check("the login page can't be used to redirect off-site", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    await page.goto(`${baseUrl}/login?next=${encodeURIComponent("https://evil.example/")}`);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl}/`);
  });

  await check("security settings show this browser, the audit trail, and change the password", async () => {
    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("heading", { name: "Security" }).waitFor();
    await page.getByText("this browser", { exact: true }).waitFor();
    await page.getByText("auth.login_failed").waitFor();
    await page.getByLabel("Current password").fill("wrong current password");
    await page.getByLabel("New password").fill("a brand new password 42");
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByRole("alert").getByText(/incorrect/).waitFor();
    await page.getByLabel("Current password").fill(password);
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByText("Password changed.").waitFor();
    // Put it back so later suites and reruns work.
    await page.getByLabel("Current password").fill("a brand new password 42");
    await page.getByLabel("New password").fill(password);
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByText("Password changed.").waitFor();
  });
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} auth checks passed`);
process.exit(failed.length ? 1 : 0);
