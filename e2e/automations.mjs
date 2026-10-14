// Browser test for automations: building flows, running them, triggers, webhooks, the scheduler, and safety checks.
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await addSession(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("status of 4")) errors.push(`console: ${message.text()}`);
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
async function until(predicate, timeoutMs = 20_000, what = "condition") {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
const notes = async () => (await api("/api/notes")).body.notes;
const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

async function useTemplate(label) {
  await page.goto(`${baseUrl}/automations`);
  await page.getByRole("button", { name: `Use the template: ${label}` }).click();
  await page.waitForURL(/\/automations\/[^/]+$/);
  await page.getByLabel("Automation name").waitFor();
  return page.url().split("/").pop();
}

try {
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });

  await check("automations: starts empty and offers ideas to start from", async () => {
    await page.goto(`${baseUrl}/automations`);
    await page.getByRole("heading", { name: "Automations", level: 1 }).waitFor();
    await page.getByText("No automations yet").waitFor();
    for (const name of ["Morning briefing", "Log finished tasks", "Capture tasks from a web address", "Friday weekly review reminder"]) {
      await page.getByRole("button", { name: `Use the template: ${name}` }).waitFor();
    }
  });

  await check("automations: build a flow by hand, using a value from an earlier step, and run it", async () => {
    await page.goto(`${baseUrl}/automations`);
    await page.getByRole("button", { name: "New automation" }).click();
    await page.waitForURL(/\/automations\/[^/]+$/);
    const id = page.url().split("/").pop();
    await page.getByLabel("Automation name").fill("Hand-built");
    // Steps are added from a menu; the Run button waits for a saved flow with at least one step.
    assert.equal(await page.getByRole("button", { name: "Run now" }).isDisabled(), true);
    await page.getByRole("button", { name: "Add a step", exact: true }).click();
    await page.getByRole("dialog", { name: "Add a step" }).getByRole("button", { name: /Look up tasks/ }).click();
    await page.getByRole("button", { name: "Add a step", exact: true }).click();
    await page.getByRole("dialog", { name: "Add a step" }).getByRole("button", { name: /Create a note/ }).click();
    const step2 = page.getByRole("article", { name: "Step 2: Create a note" });
    await step2.getByLabel("Title", { exact: true }).fill("Digest for ");
    await step2.getByLabel("Insert a value into Title").selectOption("today");
    await step2.getByLabel("Content (Markdown)", { exact: true }).fill("Tasks:\n");
    await step2.getByLabel("Insert a value into Content (Markdown)").selectOption("steps.1.output");
    await page.getByText("You have unsaved changes.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Run now" }).isDisabled(), true, "unsaved changes must be saved before running");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Saved.").waitFor();

    await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Pay the electricity bill", dueDate: todayKey }) });
    await page.getByRole("button", { name: "Run now" }).click();
    const result = page.getByRole("region", { name: "Result of the last manual run" });
    await result.getByText("Succeeded").waitFor();
    await result.getByText("Look up tasks").click();
    await result.getByText("Pay the electricity bill").first().waitFor();
    const note = (await notes()).find((n) => n.title === `Digest for ${todayKey}`);
    assert.ok(note, "the note was created with the filled-in title");
    const full = (await api(`/api/notes/${note.id}`)).body.note;
    assert.match(full.content, /Pay the electricity bill/);
    assert.equal((await api(`/api/automations/${id}`)).body.runs.length, 1);
  });

  await check("automations: steps can be moved and removed, and the flow shows each one in order", async () => {
    await page.goto(`${baseUrl}/automations`);
    await page.getByRole("link", { name: /Hand-built/ }).first().click();
    await page.getByRole("article", { name: "Step 1: Look up tasks" }).waitFor();
    await page.getByRole("button", { name: "Move step 1 down" }).click();
    await page.getByRole("article", { name: "Step 1: Create a note" }).waitFor();
    await page.getByRole("article", { name: "Step 2: Look up tasks" }).waitFor();
    await page.getByRole("button", { name: "Remove step 2" }).click();
    assert.equal(await page.getByRole("article", { name: /Step 2/ }).count(), 0);
    await page.getByText("You have unsaved changes.").waitFor();
  });

  await check("automations: a condition stops a run quietly and skips what follows", async () => {
    const created = await api("/api/automations", {
      method: "POST",
      body: JSON.stringify({
        name: "Only urgent",
        trigger: { type: "manual" },
        steps: [
          { id: "c1", type: "condition", value: "routine", operator: "contains", compare: "urgent" },
          { id: "n1", type: "create_note", title: "Should never exist", content: "" },
        ],
      }),
    });
    await page.goto(`${baseUrl}/automations/${created.body.workflow.id}`);
    await page.getByRole("button", { name: "Run now" }).click();
    const result = page.getByRole("region", { name: "Result of the last manual run" });
    await result.getByText("Stopped by a condition").first().waitFor();
    await result.getByText("skipped", { exact: true }).waitFor();
    assert.ok(!(await notes()).some((n) => n.title === "Should never exist"));
  });

  await check("automations: a failing step is explained in plain words, and later steps don't run", async () => {
    const created = await api("/api/automations", {
      method: "POST",
      body: JSON.stringify({
        name: "Call the intranet",
        trigger: { type: "manual" },
        steps: [
          { id: "h1", type: "http_request", method: "GET", url: "http://localhost:3000/api/tasks", headers: [{ name: "Authorization", value: "Bearer top-secret" }], body: "", failOnError: true },
          { id: "n1", type: "create_note", title: "After the failure", content: "" },
        ],
      }),
    });
    await page.goto(`${baseUrl}/automations/${created.body.workflow.id}`);
    await page.getByRole("button", { name: "Run now" }).click();
    const result = page.getByRole("region", { name: "Result of the last manual run" });
    await result.getByRole("alert").getByText(/Step 1 failed: Addresses on this machine or your local network are blocked/).waitFor();
    await result.getByText("Failed").first().waitFor();
    assert.ok(!(await notes()).some((n) => n.title === "After the failure"));
    assert.ok(!JSON.stringify((await api(`/api/automations/${created.body.workflow.id}`)).body.runs).includes("top-secret"), "header values never reach run history");
  });

  await check("automations: the AI template runs, billed like any model call, and writes a briefing note", async () => {
    const id = await useTemplate("Morning briefing");
    await page.getByRole("article", { name: "Step 3: Ask the AI" }).waitFor();
    await page.getByRole("button", { name: "Run now" }).click();
    const result = page.getByRole("region", { name: "Result of the last manual run" });
    await result.getByText("Succeeded").waitFor({ timeout: 30_000 });
    const note = await until(async () => (await notes()).find((n) => n.title === `Briefing ${todayKey}`), 10_000, "the briefing note");
    assert.ok(note);
    const run = (await api(`/api/automations/${id}`)).body.runs[0];
    assert.deepEqual(run.steps.map((s) => s.status), ["ok", "ok", "ok", "ok"]);
    assert.ok(typeof run.steps[2].output === "string" && run.steps[2].output.length > 0);
    const usage = (await api("/api/usage")).body;
    assert.ok(JSON.stringify(usage).includes("mock/free-model"));
  });

  await check("automations: nothing runs until it's switched on, then completing a task writes the log note", async () => {
    const id = await useTemplate("Log finished tasks");
    const task = (await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Finish the report" }) })).body.task;
    await api(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.ok(!(await notes()).some((n) => n.title === "Done: Finish the report"), "an automation that is off does nothing");

    await page.getByRole("switch", { name: "Switch on" }).click();
    await page.getByRole("switch", { name: "Switch off" }).waitFor();
    const second = (await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Ship the release" }) })).body.task;
    await api(`/api/tasks/${second.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    await until(async () => (await notes()).find((n) => n.title === "Done: Ship the release"), 15_000, "the log note");
    const runs = (await api(`/api/automations/${id}`)).body.runs;
    assert.equal(runs.length, 1);
    assert.equal(runs[0].triggerType, "task_completed");
    await page.reload();
    await page.getByText("Run history").waitFor();
    await page.getByText("Succeeded").first().waitFor();
  });

  await check("automations: a webhook address works without signing in, only while switched on, and the secret is shown once", async () => {
    const id = await useTemplate("Capture tasks from a web address");
    await page.getByRole("button", { name: "Create address" }).click();
    const address = await page.getByLabel("Webhook address").inputValue();
    assert.match(address, /\/api\/hooks\/omni_hook_/);
    await page.getByText("Copy this address now.").waitFor();

    // Off: looks exactly like an address that doesn't exist.
    const off = await fetch(address, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nope" }) });
    assert.equal(off.status, 404);

    await page.getByRole("switch", { name: "Switch on" }).click();
    await page.getByRole("switch", { name: "Switch off" }).waitFor();
    const response = await fetch(address, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://some-service.example" }, body: JSON.stringify({ title: "From a shortcut", notes: "sent by curl" }) });
    assert.equal(response.status, 202);
    const task = await until(async () => (await api("/api/tasks")).body.tasks.find((t) => t.title === "From a shortcut"), 15_000, "the task");
    assert.equal(task.description, "sent by curl");
    assert.deepEqual(task.tags, ["inbox"]);

    assert.equal((await fetch(`${baseUrl}/api/hooks/omni_hook_wrong`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/hooks/omni_hook_wrong/extra`, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(address, { method: "POST", headers: { "Content-Length": String(200_000) }, body: "x".repeat(200_000) })).status, 413);

    await page.reload();
    await page.getByText(/An address exists, but it can only be shown when it's created/).waitFor();
    assert.equal(await page.getByLabel("Webhook address").count(), 0, "the secret isn't shown again");
    await page.getByRole("button", { name: "Make a new address" }).click();
    const replaced = await page.getByLabel("Webhook address").inputValue();
    assert.notEqual(replaced, address);
    assert.equal((await fetch(address, { method: "POST", body: JSON.stringify({ title: "Old address" }) })).status, 404, "the old address stops working");
    assert.ok(id);
  });

  await check("automations: the scheduler runs a due automation by itself", async () => {
    const created = await api("/api/automations", {
      method: "POST",
      body: JSON.stringify({
        name: "Every hour",
        trigger: { type: "schedule", schedule: { frequency: "interval", everyMinutes: 60, timezone: "UTC" } },
        steps: [{ id: "n1", type: "create_note", title: "Scheduled tick", content: "" }],
      }),
    });
    const id = created.body.workflow.id;
    const switched = await api(`/api/automations/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    assert.ok(new Date(switched.body.workflow.nextRunAt).getTime() > Date.now() + 55 * 60_000, "the next run is an hour away");
    // Pretend the hour has passed.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`UPDATE "Workflow" SET "nextRunAt" = now() - interval '1 minute' WHERE id = $1`, [id]);
    } finally {
      await client.end();
    }
    const run = await until(async () => (await api(`/api/automations/${id}`)).body.runs[0], 45_000, "the scheduled run");
    assert.equal(run.triggerType, "schedule");
    assert.equal(run.status, "succeeded");
    assert.ok((await notes()).some((n) => n.title === "Scheduled tick"));
    const after = (await api(`/api/automations/${id}`)).body.workflow;
    assert.ok(new Date(after.nextRunAt).getTime() > Date.now() + 55 * 60_000, "and it's scheduled for the next hour");
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    assert.equal((await api(`/api/automations/${id}`)).body.runs.length, 1, "it doesn't run twice");
  });

  await check("automations: the API validates input, refuses to switch on an empty flow, and needs a sign-in", async () => {
    assert.equal((await api("/api/automations", { method: "POST", body: JSON.stringify({ name: "x", trigger: { type: "telepathy" } }) })).status, 400);
    assert.equal((await api("/api/automations", { method: "POST", body: JSON.stringify({ name: "x", trigger: { type: "schedule", schedule: { frequency: "interval", everyMinutes: 1, timezone: "UTC" } } }) })).status, 400);
    const empty = (await api("/api/automations", { method: "POST", body: JSON.stringify({ name: "Empty", trigger: { type: "manual" } }) })).body.workflow;
    const refused = await api(`/api/automations/${empty.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, "no_steps");
    assert.equal((await fetch(`${baseUrl}/api/automations`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/automations/${empty.id}/run`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/automation-runs`)).status, 401);
  });

  await check("automations: deleting asks first, and removes the automation and its history", async () => {
    await page.goto(`${baseUrl}/automations`);
    await page.getByRole("link", { name: /Every hour/ }).first().click();
    await page.getByRole("button", { name: "Delete this automation" }).click();
    await page.getByRole("dialog", { name: "Delete this automation?" }).getByRole("button", { name: "Cancel" }).click();
    assert.ok((await api("/api/automations")).body.workflows.some((w) => w.name === "Every hour"));
    await page.getByRole("button", { name: "Delete this automation" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.waitForURL(/\/automations$/);
    assert.ok(!(await api("/api/automations")).body.workflows.some((w) => w.name === "Every hour"));
  });

  await check("mobile: the list and the editor fit a phone screen", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    const first = (await api("/api/automations")).body.workflows[0];
    for (const path of ["/automations", `/automations/${first.id}`]) {
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
console.log(`\n${results.length - failed.length}/${results.length} automation checks passed`);
process.exit(failed.length ? 1 : 0);
