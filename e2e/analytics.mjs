// Browser test for Analytics: the API's windows, a real task showing up in the counts, the page and its range buttons.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await addSession(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/status of (4|5)\d\d/.test(message.text())) errors.push(`console: ${message.text()}`);
});

async function api(path, init = {}) {
  const response = await retryingFetch(`${baseUrl}${path}`, { headers: sessionHeaders({ "Content-Type": "application/json" }), ...init });
  return { status: response.status, body: await response.json() };
}
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n  ${error.message}`);
  }
}

try {
  await check("analytics: the API returns a full window for each range", async () => {
    for (const days of [7, 30, 90]) {
      const { status, body } = await api(`/api/analytics?days=${days}&tz=UTC`);
      assert.equal(status, 200);
      assert.equal(body.analytics.tasks.created.length, days);
      assert.equal(body.analytics.ai.spendByDay.length, days);
    }
  });

  await check("analytics: an unsupported range falls back to 30 days", async () => {
    const { body } = await api("/api/analytics?days=5&tz=UTC");
    assert.equal(body.analytics.days, 30);
  });

  await check("analytics: a task created now shows up in the counts", async () => {
    const before = (await api("/api/analytics?days=7&tz=UTC")).body.analytics.tasks.totals.created;
    const made = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Analytics probe" }) });
    assert.equal(made.status, 201);
    const after = (await api("/api/analytics?days=7&tz=UTC")).body.analytics.tasks.totals.created;
    assert.equal(after, before + 1);
  });

  await check("analytics: the page shows every section and the range buttons work", async () => {
    await page.goto(`${baseUrl}/analytics`);
    await page.getByRole("heading", { name: "Analytics", level: 1 }).waitFor();
    for (const name of ["Tasks", "Time", "AI usage", "Activity"]) await page.getByRole("heading", { name, level: 2, exact: true }).waitFor();
    await page.getByRole("button", { name: "90 days" }).click();
    await page.locator('[aria-label="Date range"] [aria-pressed=true]', { hasText: "90 days" }).waitFor();
    assert.equal(await page.getByRole("img", { name: "Tasks finished per day" }).count(), 1);
  });

  await check("mobile: the analytics page fits a phone screen", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    await phone.goto(`${baseUrl}/analytics`, { waitUntil: "networkidle" });
    await phone.getByRole("heading", { name: "AI usage", level: 2 }).waitFor();
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `overflows by ${overflow}px`);
    await mobile.close();
  });

  await check("no unexpected browser errors", async () => {
    assert.deepEqual(errors, [], errors.join("\n"));
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} analytics checks passed`);
process.exit(failed.length ? 1 : 0);
