// Browser test for Integrations: connecting each service for real (against stand-ins), confirmations, Google sign-in, safety.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const mockPort = process.env.MOCK_PORT ?? "4010";
const mock = `http://localhost:${mockPort}`;
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";

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
const sent = async () => (await (await fetch(`${mock}/mock/log`)).json()).log;
const row = (name) => page.getByRole("listitem", { name, exact: true });
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
  await fetch(`${mock}/mock/reset`);
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });

  await check("integrations: every service starts not connected, with nothing pretending otherwise", async () => {
    await page.goto(`${baseUrl}/integrations`);
    await page.getByRole("heading", { name: "Integrations", level: 1 }).waitFor();
    for (const name of ["GitHub", "Notion", "Todoist", "Slack", "Discord", "Google (Gmail, Calendar, Drive)"]) {
      await row(name).getByText("Not connected").waitFor();
    }
  });

  await check("integrations: a wrong token is rejected by the service and nothing is saved", async () => {
    const github = row("GitHub");
    await github.getByLabel("Personal access token").fill("ghp_wrong_token_000");
    await github.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("alert").getByText(/GitHub rejected the saved credentials/).waitFor();
    await github.getByText("Not connected").waitFor();
    assert.equal((await api("/api/integrations")).body.connections.find((c) => c.provider === "github").connected, false);
    assert.ok(!(await page.content()).includes("ghp_wrong_token_000") || (await github.getByLabel("Personal access token").inputValue()) === "ghp_wrong_token_000", "a rejected token is only ever in the box you typed it in");
  });

  await check("integrations: a good token connects, shows who you are, and is never shown or returned again", async () => {
    const github = row("GitHub");
    await github.getByLabel("Personal access token").fill("ghp_valid_token");
    await github.getByRole("button", { name: "Connect" }).click();
    await github.getByText("Connected · @octocat").waitFor();
    await page.getByText("Connected to GitHub as @octocat.").waitFor();
    assert.equal(await github.getByLabel("Personal access token").count(), 0);
    const listing = JSON.stringify((await api("/api/integrations")).body);
    assert.ok(!listing.includes("ghp_valid_token"), "the token isn't returned by the API");
    assert.ok(!(await page.content()).includes("ghp_valid_token"), "the token isn't in the page");
  });

  await check("integrations: reading just runs, and writing shows exactly what will be sent and waits for a click", async () => {
    const github = row("GitHub");
    await github.getByRole("button", { name: "Try it" }).click();
    await github.getByLabel("Try an action").selectOption({ label: "List issues" });
    await github.getByLabel("Repository").fill("acme/app");
    await github.getByRole("button", { name: "Run" }).click();
    const result = github.getByLabel("Result");
    await result.getByText("Login page is broken").waitFor();
    assert.ok(!(await result.innerText()).includes("dark mode"), "pull requests aren't listed as issues");

    await github.getByLabel("Try an action").selectOption({ label: "Open an issue (changes something)" });
    await github.getByLabel("Repository").fill("acme/app");
    await github.getByLabel("Title").fill("Typo on the home page");
    await github.getByLabel("Description").fill("Says 'recieve'.");
    await github.getByRole("button", { name: "Review and send…" }).click();
    const dialog = page.getByRole("dialog", { name: "Send to GitHub?" });
    await dialog.getByText("This is exactly what will be sent:").waitFor();
    await dialog.getByText("Typo on the home page").waitFor();
    await dialog.getByText("Says 'recieve'.").waitFor();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    assert.equal((await sent()).length, 0, "cancelling sends nothing");

    await github.getByRole("button", { name: "Review and send…" }).click();
    await page.getByRole("dialog", { name: "Send to GitHub?" }).getByRole("button", { name: "Open an issue" }).click();
    await github.getByLabel("Result").getByText("https://github.com/acme/app/issues/7").waitFor();
    const log = await sent();
    assert.equal(log.length, 1);
    assert.deepEqual(log[0].body, { title: "Typo on the home page", body: "Says 'recieve'." });
  });

  await check("integrations: the server refuses a change that wasn't confirmed, and unknown or malformed requests", async () => {
    const before = (await sent()).length;
    const unconfirmed = await api("/api/integrations/actions", { method: "POST", body: JSON.stringify({ action: "github.create_issue", params: { repo: "acme/app", title: "sneaky" } }) });
    assert.equal(unconfirmed.status, 400);
    assert.equal(unconfirmed.body.error.code, "confirmation_required");
    assert.equal((await api("/api/integrations/actions", { method: "POST", body: JSON.stringify({ action: "github.nuke", params: {}, confirm: true }) })).status, 404);
    assert.equal((await api("/api/integrations/actions", { method: "POST", body: JSON.stringify({ action: "github.list_issues", params: { repo: "../../user" } }) })).status, 400);
    assert.equal((await api("/api/integrations/actions", { method: "POST", body: JSON.stringify({ action: "slack.post_message", params: { text: "x" }, confirm: true }) })).body.error.code, "not_connected");
    assert.equal((await sent()).length, before, "none of those sent anything");
  });

  await check("integrations: Slack accepts only real webhook addresses and is honest that it can't verify one", async () => {
    const slack = row("Slack");
    await slack.getByLabel("Incoming webhook address").fill("https://evil.example/steal");
    await slack.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("alert").getByText(/isn't a Slack webhook address/).waitFor();
    await slack.getByLabel("Incoming webhook address").fill(`${mock}/hooks/slack/T0/B0/abcd1234`);
    await slack.getByRole("button", { name: "Connect" }).click();
    await page.getByText(/can't check it without posting, so your first message is the real test/).waitFor();
    await slack.getByText("Not verified").waitFor();
    assert.equal(await slack.getByRole("button", { name: "Test" }).count(), 0, "there's no pretend test");
    await slack.getByRole("button", { name: "Try it" }).click();
    await slack.getByLabel("Message").fill("Deploy finished <!channel> & done");
    await slack.getByRole("button", { name: "Review and send…" }).click();
    await page.getByRole("dialog", { name: "Send to Slack?" }).getByRole("button", { name: "Post a message" }).click();
    await slack.getByLabel("Result").getByText("posted").waitFor();
    const message = (await sent()).find((entry) => entry.service === "slack");
    assert.equal(message.body.text, "Deploy finished &lt;!channel&gt; &amp; done");
  });

  await check("integrations: Discord is checked with the service, Todoist and Notion connect and work", async () => {
    const discord = row("Discord");
    await discord.getByLabel("Webhook address").fill(`${mock}/hooks/discord/badhook/token`);
    await discord.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("alert").getByText(/Discord couldn't find what was asked for/).waitFor();
    await discord.getByLabel("Webhook address").fill(`${mock}/hooks/discord/123/token`);
    await discord.getByRole("button", { name: "Connect" }).click();
    await discord.getByText("Connected · Alerts channel").waitFor();

    const todoist = row("Todoist");
    await todoist.getByLabel("API token").fill("todoist_valid");
    await todoist.getByRole("button", { name: "Connect" }).click();
    await todoist.getByText(/Connected · 1 project/).waitFor();
    await todoist.getByRole("button", { name: "Try it" }).click();
    await todoist.getByRole("button", { name: "Run" }).click();
    await todoist.getByLabel("Result").getByText("Pay rent").waitFor();

    const notion = row("Notion");
    await notion.getByLabel("Internal integration secret").fill("secret_valid_notion");
    await notion.getByRole("button", { name: "Connect" }).click();
    await notion.getByText("Connected · Acme Workspace").waitFor();
    await notion.getByRole("button", { name: "Try it" }).click();
    await notion.getByLabel("Search for").fill("road");
    await notion.getByRole("button", { name: "Run" }).click();
    await notion.getByLabel("Result").getByText("Roadmap").waitFor();
  });

  await check("integrations: the Test button reports success, and a revoked token shows the problem plainly", async () => {
    const github = row("GitHub");
    await github.getByRole("button", { name: "Test" }).click();
    await page.getByText(/GitHub is working \(@octocat\)/).waitFor();
    // Replace the saved token with one the service will reject, as if it had been revoked.
    await api("/api/integrations/github", { method: "DELETE" });
    await page.reload();
    await row("GitHub").getByText("Not connected").waitFor();
    await row("GitHub").getByLabel("Personal access token").fill("ghp_valid_token");
    await row("GitHub").getByRole("button", { name: "Connect" }).click();
    await row("GitHub").getByText("Connected · @octocat").waitFor();
  });

  await check("integrations: Google signs in through its own page, then reads mail without fetching bodies", async () => {
    const google = row("Google (Gmail, Calendar, Drive)");
    await google.getByRole("link", { name: "Connect: read only" }).click();
    await page.waitForURL(/\/integrations\?connected=google/);
    await page.getByText("Connected to Google (Gmail, Calendar, Drive) as me@example.com.").waitFor();
    await row("Google (Gmail, Calendar, Drive)").getByText("Connected · me@example.com").waitFor();
    const listing = JSON.stringify((await api("/api/integrations")).body);
    assert.ok(!listing.includes("google-access") && !listing.includes("google-refresh"));

    const g = row("Google (Gmail, Calendar, Drive)");
    await g.getByRole("button", { name: "Try it" }).click();
    await g.getByLabel("Try an action").selectOption({ label: "List recent email" });
    await g.getByRole("button", { name: "Run" }).click();
    await g.getByLabel("Result").getByText("Lunch Thursday?").waitFor();
    await g.getByLabel("Result").getByText("Are we still on for lunch?").waitFor();
  });

  await check("integrations: a forged or replayed Google sign-in link is refused", async () => {
    await page.goto(`${baseUrl}/api/integrations/google/callback?code=abc&state=forged`);
    await page.waitForURL(/\/integrations\?error=/);
    await page.getByRole("alert").getByText(/expired or wasn't started here/).waitFor();
    await page.goto(`${baseUrl}/api/integrations/google/callback?error=access_denied`);
    await page.getByRole("alert").getByText(/You didn't allow access/).waitFor();
  });

  await check("integrations: Google Calendar events are imported into Omni once, and a second import updates them", async () => {
    await page.goto(`${baseUrl}/integrations`);
    const g = row("Google (Gmail, Calendar, Drive)");
    await g.getByRole("button", { name: "Try it" }).click();
    await g.getByLabel("Try an action").selectOption({ label: "Import events into Omni (changes something)" });
    await g.getByRole("button", { name: "Review and send…" }).click();
    await page.getByRole("dialog", { name: "Send to Google (Gmail, Calendar, Drive)?" }).getByRole("button", { name: "Import events into Omni" }).click();
    await g.getByLabel("Result").getByText("\"created\": 2").waitFor();
    const range = `from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86_400_000).toISOString())}`;
    const events = (await api(`/api/calendar?${range}`)).body.occurrences.filter((o) => o.title.startsWith("Google"));
    assert.deepEqual(events.map((e) => e.title).sort(), ["Google offsite", "Google standup"]);
    assert.equal(events.find((e) => e.title === "Google offsite").allDay, true);
    await g.getByRole("button", { name: "Review and send…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Import events into Omni" }).click();
    await g.getByLabel("Result").getByText("\"updated\": 2").waitFor();
    assert.equal((await api(`/api/calendar?${range}`)).body.occurrences.filter((o) => o.title.startsWith("Google")).length, 2);
  });

  await check("integrations: a Drive document is added to Knowledge and becomes searchable", async () => {
    const g = row("Google (Gmail, Calendar, Drive)");
    await g.getByLabel("Try an action").selectOption({ label: "Search Drive" });
    await g.getByLabel("File name contains").fill("plan");
    await g.getByRole("button", { name: "Run" }).click();
    await g.getByLabel("Result").getByText("Quarterly plan").waitFor();
    await g.getByLabel("Try an action").selectOption({ label: "Add a Drive file to Knowledge (changes something)" });
    await g.getByLabel("File ID").fill("docfile0001");
    await g.getByRole("button", { name: "Review and send…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add a Drive file to Knowledge" }).click();
    await g.getByLabel("Result").getByText("Drive: Quarterly plan").waitFor();
    const doc = (await api("/api/knowledge")).body.documents.find((d) => d.name === "Drive: Quarterly plan");
    assert.ok(doc);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const found = (await api("/api/knowledge/search", { method: "POST", body: JSON.stringify({ query: "launch the beta in spring" }) })).body;
    assert.equal(found.hits[0].documentName, "Drive: Quarterly plan");
  });

  await check("integrations: an automation step can use a connected service, and agents can only draft email, never send it", async () => {
    const created = await api("/api/automations", {
      method: "POST",
      body: JSON.stringify({ name: "Tell Slack", trigger: { type: "manual" }, steps: [{ id: "s1", type: "integration", action: "slack.post_message", params: { text: "Hello from {{today}}" } }] }),
    });
    await page.goto(`${baseUrl}/automations/${created.body.workflow.id}`);
    await page.getByRole("article", { name: "Step 1: Use a connected service" }).waitFor();
    await page.getByRole("button", { name: "Run now" }).click();
    await page.getByRole("region", { name: "Result of the last manual run" }).getByText("Succeeded").waitFor({ timeout: 20_000 });
    const posted = (await sent()).filter((entry) => entry.service === "slack").at(-1);
    assert.match(posted.body.text, /^Hello from \d{4}-\d{2}-\d{2}$/);

    const agents = (await api("/api/agents")).body.agents;
    const email = agents.find((a) => a.name === "Email Agent");
    assert.ok(email.tools.includes("gmail_create_draft") && email.approvalTools.includes("gmail_create_draft"));
    assert.ok(!agents.some((a) => a.tools.some((tool) => /send_email|gmail_send/.test(tool))));
    const tools = (await api("/api/agent-tools")).body.tools;
    assert.equal(tools.find((t) => t.name === "github_create_issue").risk, "write");
    assert.equal(tools.find((t) => t.name === "github_list_issues").risk, "read");
  });

  await check("integrations: disconnecting asks first, deletes the credentials, and the service stops working", async () => {
    await page.goto(`${baseUrl}/integrations`);
    const github = row("GitHub");
    await github.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog", { name: "Disconnect GitHub?" }).getByRole("button", { name: "Cancel" }).click();
    assert.equal((await api("/api/integrations")).body.connections.find((c) => c.provider === "github").connected, true);
    await github.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await github.getByText("Not connected").waitFor();
    await page.getByText(/Disconnected GitHub. Its saved credentials were deleted/).waitFor();
    const after = await api("/api/integrations/actions", { method: "POST", body: JSON.stringify({ action: "github.list_repos", params: {} }) });
    assert.equal(after.body.error.code, "not_connected");
  });

  await check("integrations: every route needs a sign-in", async () => {
    for (const [method, path] of [["GET", "/api/integrations"], ["PUT", "/api/integrations/github"], ["DELETE", "/api/integrations/github"], ["POST", "/api/integrations/actions"], ["POST", "/api/integrations/github/test"], ["GET", "/api/integrations/google/start"]]) {
      const response = await fetch(`${baseUrl}${path}`, { method, body: method === "GET" || method === "DELETE" ? undefined : "{}", redirect: "manual" });
      assert.equal(response.status, 401, path);
    }
  });

  await check("mobile: the integrations page fits a phone screen", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    await phone.goto(`${baseUrl}/integrations`, { waitUntil: "networkidle" });
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
console.log(`\n${results.length - failed.length}/${results.length} integration checks passed`);
process.exit(failed.length ? 1 : 0);
