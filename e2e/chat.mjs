// Browser test for the OpenRouter chat flow. Requires the app to be running against the mock
// OpenRouter server (see scripts/e2e.mjs, which starts everything).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";
const WRONG_KEY = "sk-or-v1-wrong-key-000000";

const screenshotDir = process.env.OMNI_SCREENSHOT_DIR;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("status of 4")) errors.push(`console: ${message.text()}`);
});

async function waitFor(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not met before timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

async function newChat() {
  await page.getByRole("button", { name: "New chat" }).first().click();
  await page.getByRole("textbox", { name: "Message" }).waitFor();
}

async function send(text) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

try {
  await check("a wrong key is saved, then fails the connection test with a clear message", async () => {
    await page.goto(`${baseUrl}/settings`);
    await page.locator("#openrouter-key").fill(WRONG_KEY);
    await page.getByRole("button", { name: "Save key" }).click();
    await page.getByText("API key saved and encrypted").waitFor();
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.getByRole("alert").filter({ hasText: "rejected the API key" }).waitFor();
  });

  await check("a valid key connects, and the key is masked after saving", async () => {
    await page.locator("#openrouter-key").fill(VALID_KEY);
    await page.getByRole("button", { name: "Save key" }).click();
    await page.getByText("…3456").first().waitFor();
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.getByText("Connected to OpenRouter").waitFor();
    assert.equal(await page.locator("#openrouter-key").inputValue(), "", "the key must not be echoed back");
    const html = await page.content();
    assert.ok(!html.includes(VALID_KEY), "the full key must not appear in the page");
  });

  await check("the model catalog loads and a default model can be chosen", async () => {
    await page.getByRole("button", { name: "Choose a model" }).first().click();
    const list = page.getByRole("listbox", { name: "Models" });
    await list.getByText("Mock Pro").waitFor();
    await list.getByText("Mock Free").click();
    await page.getByText("Mock Free · mock/free-model").waitFor();
  });

  await check("a chat reply streams in and usage is recorded on the message", async () => {
    await page.goto(`${baseUrl}/chat`);
    await newChat();
    await send("Say hello");
    await page.getByText("Hello from the mock model.").waitFor();
    await page.getByText("Glad to help.").waitFor();
    await page.getByText("20 in · 8 out · $0.00012").waitFor();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/chat-reply.png` });
    await waitFor(() => page.url().match(/\/chat\/[a-z0-9]+$/) !== null);
  });

  await check("stopping mid-reply keeps the partial text", async () => {
    await newChat();
    await send("slow answer please");
    await page.getByRole("button", { name: "Stop generating" }).waitFor();
    await page.getByText("word1").first().waitFor();
    await page.getByRole("button", { name: "Stop generating" }).click();
    await page.getByText("Stopped. The partial reply was kept.").waitFor();
    assert.ok((await page.getByText("word0").count()) > 0, "partial text should remain visible");
  });

  await check("a mid-stream provider error is shown and the partial text kept", async () => {
    await newChat();
    await send("please break");
    await page.getByRole("alert").filter({ hasText: "rate limit" }).waitFor();
    await page.getByText("Partial part").waitFor();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/chat-error.png` });
  });

  await check("the conversation persists across reloads and can be renamed", async () => {
    await page.reload();
    await page.getByText("Partial part").first().waitFor();
    await page.getByRole("alert").filter({ hasText: "rate limit" }).waitFor();
    await page.getByRole("button", { name: "Rename conversation" }).click();
    const title = page.getByRole("textbox", { name: "Conversation title" });
    await title.fill("Renamed chat");
    await title.press("Enter");
    await page.getByRole("heading", { name: "Renamed chat" }).waitFor();
  });

  await check("a monthly spending limit blocks new messages", async () => {
    await page.goto(`${baseUrl}/settings`);
    await page.locator("#monthly-budget").fill("0.00001");
    await page.getByRole("button", { name: "Save limit" }).click();
    await page.getByText("Spending limit saved.").waitFor();
    await page.goto(`${baseUrl}/chat`);
    await page.getByRole("textbox", { name: "Message" }).first().waitFor();
    await page.getByRole("button", { name: "New chat" }).first().click();
    await send("this should be blocked");
    await page.getByRole("alert").filter({ hasText: "Monthly spending limit reached" }).waitFor();
  });

  await check("usage totals appear in settings, and the limit can be removed", async () => {
    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("button", { name: "Remove limit" }).click();
    await page.getByText("Spending limit removed.").waitFor();
    await page.getByText(/AI usage · last 30 days/).waitFor();
    await page.getByText("Requests", { exact: true }).first().waitFor();
    await page.getByRole("cell", { name: "mock/free-model" }).waitFor();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/settings-openrouter.png`, fullPage: true });
  });

  await check("a conversation can be deleted after confirmation", async () => {
    await page.goto(`${baseUrl}/chat`);
    const row = page.getByRole("button", { name: "Delete Renamed chat" });
    await row.waitFor();
    await row.click({ force: true });
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete Renamed chat" }).waitFor({ state: "detached" });
  });
} finally {
  await browser.close();
}

const failed = results.filter((item) => !item.ok);
if (errors.length > 0) {
  console.log("Browser errors observed:");
  for (const message of errors) console.log(`  ${message}`);
}
console.log(`\n${results.length - failed.length}/${results.length} chat checks passed`);
if (failed.length > 0 || errors.length > 0) process.exitCode = 1;
