// Browser test for Research: setup, a full run with real (mock) search and pages, citations, saving, stopping, failures.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const mockPort = process.env.MOCK_PORT ?? "4010";
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await addSession(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("status of 4") && !message.text().includes("status of 5")) errors.push(`console: ${message.text()}`);
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
const QUESTION = "How has the cost of solar power changed over the last decade?";
async function ask(question) {
  await page.goto(`${baseUrl}/research`);
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Research", exact: true }).click();
}

try {
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });
  await api("/api/research/settings", { method: "PUT", body: JSON.stringify({ provider: null }) });

  await check("research: without a search service it says what's needed instead of failing", async () => {
    await page.goto(`${baseUrl}/research`);
    await page.getByRole("heading", { name: "Research", level: 1 }).waitFor();
    await page.getByRole("region", { name: "Set up web search" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Research", exact: true }).isDisabled(), true);
    const response = await api("/api/research", { method: "POST", body: JSON.stringify({ question: QUESTION }) });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "search_not_configured");
    assert.match(response.body.error.message, /provider in Settings/);
  });

  await check("research: choose a provider, save, and test it, right on the page", async () => {
    const setup = page.getByRole("region", { name: "Set up web search" });
    await setup.getByLabel("Provider").selectOption("searxng");
    await setup.getByLabel("Address of your instance").fill(`http://localhost:${mockPort}/searxng`);
    await setup.getByRole("button", { name: "Save", exact: true }).click();
    // Once search is ready the setup form gets out of the way.
    await page.getByRole("region", { name: "Set up web search" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("button", { name: "Research", exact: true }).isDisabled(), true, "still needs a question");
    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("button", { name: "Test search" }).click();
    await page.getByText(/Connected: the search service answered with results/).waitFor();
  });

  await check("research: API keys are saved encrypted, shown only by their last four characters, and never returned", async () => {
    await api("/api/research/settings", { method: "PUT", body: JSON.stringify({ provider: "brave", apiKey: "BSA-live-secret-key-4321" }) });
    const view = await api("/api/research/settings");
    assert.equal(view.body.settings.keyLast4, "4321");
    assert.ok(!JSON.stringify(view.body).includes("BSA-live-secret"));
    await page.goto(`${baseUrl}/settings`);
    await page.getByText("A key ending in 4321 is saved.").waitFor();
    assert.ok(!(await page.content()).includes("BSA-live-secret"));
    assert.equal(await page.getByLabel("API key").last().inputValue(), "");
    await page.getByRole("button", { name: "Remove key" }).click();
    await page.getByText("Key removed.").waitFor();
    await api("/api/research/settings", { method: "PUT", body: JSON.stringify({ provider: "searxng", baseUrl: `http://localhost:${mockPort}/searxng` }) });
  });

  await check("research: a question becomes a cited report from real pages, with sources you can check", async () => {
    await ask(QUESTION);
    const current = page.getByRole("region", { name: "Current research" });
    await current.getByText("Planning what to search for…").waitFor();
    await current.getByText(/Searched for:/).waitFor({ timeout: 30_000 });
    await current.getByText("Solar panels became far cheaper over the decade").waitFor({ timeout: 30_000 });
    // The save buttons appear once the report is finished and its citations have been checked.
    await current.getByRole("button", { name: "Save as note" }).waitFor({ timeout: 30_000 });
    const sources = current.getByRole("list", { name: "Sources" });
    await sources.getByRole("link", { name: /Solar costs explained/ }).waitFor();
    await sources.getByRole("link", { name: /Wind costs explained/ }).waitFor();
    await sources.getByText("Page read").first().waitFor();
    await sources.getByText("Search snippet only").waitFor();
    await sources.getByText("The site answered with HTTP 404.").waitFor();
    // Citations that match a source are links to it; the invented one was removed.
    const text = await current.locator("p", { hasText: "Solar panels became far cheaper" }).first().innerText();
    assert.ok(text.includes("1") && text.includes("2"));
    assert.ok(!text.includes("[8]") && !/\b8\b/.test(text.replace(/decade|\d+%/g, "")), "the made-up citation is gone");
    assert.equal(await current.getByRole("link", { name: "1", exact: true }).first().getAttribute("href"), "#source-1");
    assert.equal(await sources.getByText("Cited", { exact: true }).count(), 2);
    assert.equal(await sources.getByText("Not cited", { exact: true }).count(), 1);
    const link = await sources.getByRole("link", { name: /Solar costs explained/ }).evaluate((a) => [a.target, a.rel]);
    assert.deepEqual(link, ["_blank", "noopener noreferrer"]);
  });

  await check("research: the finished report is kept, can be reopened, saved as a note, and added to Knowledge", async () => {
    const reports = (await api("/api/research")).body.reports;
    assert.equal(reports[0].status, "complete");
    assert.equal(reports[0].sources.length, 3);
    assert.ok(!reports[0].report.includes("[8]"));
    await page.getByRole("button", { name: "Save as note" }).click();
    await page.getByText("Saved as a note.").waitFor();
    const note = (await api("/api/notes")).body.notes.find((n) => n.title.startsWith("Research: "));
    assert.ok(note);
    const content = (await api(`/api/notes/${note.id}`)).body.note.content;
    assert.match(content, /## Sources/);
    assert.match(content, /\[Solar costs explained\]\(http:\/\/localhost:\d+\/pages\/solar\)/);
    assert.match(content, /\(search snippet only\)/);
    await page.getByRole("button", { name: "Add to Knowledge" }).click();
    await page.getByText("Added to Knowledge, so chat can use it.").waitFor();
    assert.ok((await api("/api/knowledge")).body.documents.some((d) => d.name.startsWith("Research: ")));

    await page.getByRole("link", { name: new RegExp(QUESTION.slice(0, 30)) }).first().click();
    await page.waitForURL(/\/research\/[^/]+$/);
    await page.getByRole("heading", { name: QUESTION, level: 1 }).waitFor();
    await page.getByRole("list", { name: "Sources" }).getByRole("link", { name: /Wind costs explained/ }).waitFor();
  });

  await check("research: stopping partway keeps what was written and says it was stopped", async () => {
    await ask("Tell me about solar power, slow answer please");
    await page.getByText("Writing the report…").waitFor({ timeout: 30_000 });
    await page.getByText("word2").first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByText(/Stopped\. What was written so far is saved below/).waitFor({ timeout: 15_000 });
    const stopped = (await api("/api/research")).body.reports.find((r) => r.status === "stopped");
    assert.ok(stopped, "a stopped report is saved");
    assert.match(stopped.report, /word\d/);
  });

  await check("research: a failing search service gives a clear message and a saved failed report", async () => {
    await ask("Why is break-search broken today?");
    await page.getByRole("alert").getByText(/The search service answered with HTTP 502/).waitFor({ timeout: 30_000 });
    const failed = (await api("/api/research")).body.reports.find((r) => r.status === "failed");
    assert.ok(failed);
    assert.match(failed.error, /HTTP 502/);
  });

  await check("research: reports can be deleted, and the API needs a sign-in", async () => {
    await page.goto(`${baseUrl}/research`);
    const before = (await api("/api/research")).body.reports.length;
    await page.getByRole("button", { name: /Delete the report: Why is break-search/ }).click();
    await page.waitForFunction((count) => document.querySelectorAll("#past-heading ~ ul > li").length === count - 1, before);
    assert.equal((await api("/api/research")).body.reports.length, before - 1);
    assert.equal((await api("/api/research/reports/nope")).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/research`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/research/settings`)).status, 401);
    assert.equal((await api("/api/research", { method: "POST", body: JSON.stringify({ question: "short" }) })).body.error.code, "question_too_short");
  });

  await check("research: the Research Agent is available, and can search but not change anything", async () => {
    const agent = (await api("/api/agents")).body.agents.find((a) => a.name === "Research Agent");
    assert.ok(agent);
    assert.ok(agent.tools.includes("web_search") && agent.tools.includes("read_webpage"));
    assert.deepEqual(agent.approvalTools, []);
    assert.ok(!agent.tools.some((tool) => /^(create|update|add|append|remember)/.test(tool)));
  });

  await check("mobile: Research and a report fit a phone screen", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    const report = (await api("/api/research")).body.reports.find((r) => r.status === "complete");
    for (const path of ["/research", `/research/${report.id}`, "/settings"]) {
      await phone.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${path} overflows by ${overflow}px`);
    }
    await mobile.close();
  });

  await check("no unexpected browser errors", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} research checks passed`);
process.exit(failed.length ? 1 : 0);
