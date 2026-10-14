// End-to-end smoke test for the app shell. Requires a running server (npm run build && npm start)
// and an installed Chrome. Set OMNI_BASE_URL to override the default http://localhost:3000.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { addSession } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3000";
const screenshotDir = process.env.OMNI_SCREENSHOT_DIR;
const modifier = process.platform === "darwin" ? "Meta" : "Control";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

async function newPage(viewport, colorScheme = "light") {
  const context = await browser.newContext({ viewport, colorScheme });
  await addSession(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return page;
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not met before timeout");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error });
    console.log(`FAIL ${name}\n  ${error.message}`);
  }
}

try {
  const desktop = await newPage({ width: 1280, height: 800 });

  await check("dashboard renders greeting and sidebar", async () => {
    await desktop.goto(baseUrl);
    const greeting = await desktop.locator("h1").first().textContent();
    assert.match(greeting ?? "", /Good (morning|afternoon|evening|night)/);
    await desktop.getByRole("complementary", { name: "Sidebar" }).waitFor();
  });

  await check("Ctrl/Cmd+K opens palette, search navigates to Tasks", async () => {
    await desktop.keyboard.press(`${modifier}+k`);
    const dialog = desktop.getByRole("dialog", { name: "Command palette" });
    await dialog.waitFor();
    await desktop.getByRole("combobox").fill("tasks");
    await desktop.keyboard.press("Enter");
    await desktop.waitForURL(`${baseUrl}/tasks`);
    await desktop.getByRole("heading", { name: "Tasks", level: 1 }).waitFor();
  });

  await check("module placeholder page is honest about status", async () => {
    await desktop.goto(`${baseUrl}/calendar`);
    await desktop.getByRole("heading", { name: "Calendar", level: 1 }).waitFor();
    const text = await desktop.locator("main").textContent();
    assert.match(text ?? "", /Not built yet/);
  });

  await check("sidebar collapse shortcut toggles and persists across reload", async () => {
    const sidebarState = () =>
      desktop.getByRole("complementary", { name: "Sidebar" }).getAttribute("data-collapsed");
    await waitFor(async () => (await sidebarState()) === "false");
    await desktop.keyboard.press(`${modifier}+b`);
    await waitFor(async () => (await sidebarState()) === "true");
    await desktop.reload();
    await waitFor(async () => (await sidebarState()) === "true");
    await desktop.keyboard.press(`${modifier}+b`);
    await waitFor(async () => (await sidebarState()) === "false");
  });

  await check("theme choice applies dark class and persists across reload", async () => {
    await desktop.goto(`${baseUrl}/settings`);
    await desktop.getByRole("radio", { name: "Dark" }).click();
    assert.equal(await desktop.evaluate(() => document.documentElement.classList.contains("dark")), true);
    await desktop.reload();
    assert.equal(await desktop.evaluate(() => document.documentElement.classList.contains("dark")), true);
    assert.equal(
      await desktop.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked"),
      "true",
    );
    if (screenshotDir) await desktop.screenshot({ path: `${screenshotDir}/desktop-dark-settings.png` });
    await desktop.getByRole("radio", { name: "Light" }).click();
  });

  await check("unknown route shows the 404 page", async () => {
    const response = await desktop.goto(`${baseUrl}/no-such-page`);
    assert.equal(response?.status(), 404);
    await desktop.getByRole("heading", { name: /doesn't exist/ }).waitFor();
    // The browser logs the intentional 404 response; it is expected, so don't count it as an error.
    errors.splice(0, errors.length, ...errors.filter((message) => !message.includes("status of 404")));
  });

  await check("desktop dashboard screenshot", async () => {
    await desktop.goto(baseUrl);
    if (screenshotDir) await desktop.screenshot({ path: `${screenshotDir}/desktop-dashboard.png`, fullPage: true });
  });

  const mobile = await newPage({ width: 390, height: 844 }, "dark");

  await check("mobile hides the desktop sidebar and opens the drawer", async () => {
    await mobile.goto(baseUrl);
    const aside = mobile.getByRole("complementary", { name: "Sidebar" });
    assert.equal(await aside.isVisible(), false);
    await mobile.getByRole("button", { name: "Open navigation" }).click();
    const drawer = mobile.getByRole("dialog", { name: "Navigation" });
    await drawer.waitFor();
    await drawer.getByRole("link", { name: /^Notes/ }).click();
    await mobile.waitForURL(`${baseUrl}/notes`);
    await mobile.getByRole("dialog", { name: "Navigation" }).waitFor({ state: "detached" });
  });

  await check("mobile has no horizontal overflow on the dashboard", async () => {
    await mobile.goto(baseUrl);
    const overflow = await mobile.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `page is ${overflow}px wider than the viewport`);
    if (screenshotDir) await mobile.screenshot({ path: `${screenshotDir}/mobile-dashboard.png`, fullPage: true });
  });

  await desktop.close();
  await mobile.close();
} finally {
  await browser.close();
}

const failed = checks.filter((item) => !item.ok);
if (errors.length > 0) {
  console.log("Browser errors observed:");
  for (const message of errors) console.log(`  ${message}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0 || errors.length > 0) {
  process.exitCode = 1;
}
