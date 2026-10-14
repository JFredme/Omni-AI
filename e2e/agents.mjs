// Browser test for the agent framework: builder, runs, approvals, limits, cancellation, delegation.
// Requires the app running against the mock OpenRouter server (scripts/e2e.mjs starts everything).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";
const screenshotDir = process.env.OMNI_SCREENSHOT_DIR;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("status of 4")) errors.push(`console: ${message.text()}`);
});

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  return { status: response.status, body: await response.json() };
}

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

const tasksNamed = async (title) => (await api("/api/tasks")).body.tasks.filter((task) => task.title === title);

/** Picks an agent on /agents, types an objective, and starts the run; resolves once the run page is open. */
async function startRun(agentName, objective) {
  await page.goto(`${baseUrl}/agents`);
  await page.getByRole("combobox", { name: "Agent" }).selectOption({ label: agentName });
  await page.getByRole("textbox", { name: "Objective" }).fill(objective);
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.waitForURL(/\/agents\/runs\//);
  await page.getByRole("heading", { name: agentName, level: 1 }).waitFor();
}

// Next keeps the previous page mounted but hidden after a client-side navigation, so match visible elements only.
const status = (label) => page.locator("main header:visible").getByText(label, { exact: true });

try {
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });

  await check("agents: the built-in agents are listed, read-only, and can be duplicated", async () => {
    await page.goto(`${baseUrl}/agents`);
    await page.getByRole("heading", { name: "Agents", level: 1 }).waitFor();
    const cards = page.getByRole("list", { name: "Agents" });
    for (const name of ["General Assistant", "Project Manager", "Study Assistant", "Writing Agent"]) {
      await cards.getByRole("heading", { name }).waitFor();
    }
    await page.getByRole("button", { name: "Duplicate General Assistant" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Edit General Assistant" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Delete General Assistant" }).count(), 0);

    const builtIn = (await api("/api/agents")).body.agents.find((agent) => agent.name === "General Assistant");
    const response = await api(`/api/agents/${builtIn.id}`, { method: "PATCH", body: JSON.stringify({ name: "Hacked" }) });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "built_in_readonly");
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/agents.png`, fullPage: true });
  });

  await check("agents: the builder validates, then creates an agent with tools and permissions", async () => {
    await page.getByRole("button", { name: "New agent" }).click();
    const form = page.getByRole("dialog", { name: "New agent" });
    await form.getByLabel("Name", { exact: true }).fill("Task Helper");
    await form.getByLabel("Instructions").fill("Help with my tasks.");
    await form.getByRole("checkbox", { name: "Allow list_tasks" }).check();
    await form.getByRole("checkbox", { name: "Allow create_task" }).check();
    assert.equal(await form.getByRole("checkbox", { name: "Ask before using create_task" }).isChecked(), true, "writes ask first by default");
    assert.equal(await form.getByRole("checkbox", { name: "Ask before using list_tasks" }).count(), 0, "reads have no approval switch");

    await form.getByLabel("Maximum steps").fill("0");
    await form.getByRole("button", { name: "Create agent" }).click();
    await form.getByRole("alert").filter({ hasText: "Maximum steps must be" }).waitFor();
    await form.getByLabel("Maximum steps").fill("3");
    await form.getByRole("button", { name: "Create agent" }).click();
    await form.waitFor({ state: "hidden" });
    await page.getByRole("list", { name: "Agents" }).getByRole("heading", { name: "Task Helper" }).waitFor();

    const saved = (await api("/api/agents")).body.agents.find((agent) => agent.name === "Task Helper");
    assert.deepEqual(saved.tools.sort(), ["create_task", "list_tasks"]);
    assert.deepEqual(saved.approvalTools, ["create_task"]);
    assert.equal(saved.maxSteps, 3);
  });

  await check("runs: a read-only run completes, with its steps, result, and cost shown", async () => {
    await startRun("Task Helper", "Please list my tasks");
    await status("Completed").waitFor();
    await page.getByRole("region", { name: "Result" }).getByText("I looked at your tasks and summarized them.").waitFor();
    await page.getByRole("list", { name: "Steps" }).getByText("list_tasks").waitFor();
    await page.getByText(/2 of 3 steps/).waitFor();
    await page.getByText(/\$0\.00100/).first().waitFor();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/agent-run.png`, fullPage: true });
  });

  await check("runs: a write waits for approval, and nothing changes until the user approves", async () => {
    await startRun("Task Helper", "Please create a task");
    const approval = page.getByRole("region", { name: "Approval needed" });
    await approval.waitFor();
    await status("Needs your approval").waitFor();
    await approval.getByText("Agent-made task").waitFor();
    assert.equal((await tasksNamed("Agent-made task")).length, 0, "nothing is created before approval");

    await approval.getByRole("button", { name: "Approve" }).click();
    await status("Completed").waitFor();
    await page.getByRole("region", { name: "Result" }).getByText("I created the task.").waitFor();
    assert.equal((await tasksNamed("Agent-made task")).length, 1);
    assert.equal(await page.getByRole("region", { name: "Approval needed" }).count(), 0);
  });

  await check("runs: declining an action leaves the data alone, and the agent is told", async () => {
    await startRun("Task Helper", "Please create a task");
    const approval = page.getByRole("region", { name: "Approval needed" });
    await approval.waitFor();
    await approval.getByRole("button", { name: "Decline" }).click();
    await status("Completed").waitFor();
    await page.getByRole("region", { name: "Result" }).getByText("Understood, I did not create the task.").waitFor();
    await page.getByRole("list", { name: "Steps" }).getByText("Declined", { exact: true }).waitFor();
    assert.equal((await tasksNamed("Agent-made task")).length, 1, "still only the approved one");
  });

  await check("runs: the step limit stops a run that never finishes, and says why", async () => {
    await startRun("Task Helper", "Keep going forever");
    await status("Failed").waitFor();
    await page.getByRole("alert").filter({ hasText: "Stopped after 3 steps" }).waitFor();
    await page.getByText(/3 of 3 steps/).waitFor();
  });

  await check("runs: a run waiting on the model can be cancelled", async () => {
    await startRun("Task Helper", "stall");
    await status("Running").waitFor();
    await page.getByRole("button", { name: "Cancel run" }).click();
    await status("Cancelled").waitFor();
    assert.equal(await page.getByRole("button", { name: "Cancel run" }).count(), 0);
    await page.waitForTimeout(1_500);
    await status("Cancelled").waitFor();
  });

  await check("runs: delegation runs another agent and shows it under the run", async () => {
    await startRun("General Assistant", "Please delegate this");
    await status("Completed").waitFor();
    await page.getByRole("region", { name: "Result" }).getByText("The writing agent said: Child answer.").waitFor();
    const delegated = page.getByRole("heading", { name: "Delegated tasks" });
    await delegated.waitFor();
    const link = page.getByRole("link", { name: /Writing Agent/ });
    await link.getByText("Completed").waitFor();
    await link.click();
    await page.getByRole("heading", { name: "Writing Agent", level: 1 }).waitFor();
    await page.getByText("Child job").first().waitFor();
    await status("Completed").waitFor();
  });

  await check("runs: recent runs are listed with status and cost", async () => {
    await page.goto(`${baseUrl}/agents`);
    const list = page.getByRole("list", { name: "Recent runs" });
    await list.getByText("Please list my tasks").waitFor();
    await list.getByText("Keep going forever").waitFor();
    await list.getByText("Cancelled").waitFor();
    await list.getByText("Failed").waitFor();
    assert.equal(await list.getByText("Child job").count(), 0, "delegated runs are shown under their parent, not listed on their own");
  });

  await check("agents: editing changes only what was edited, and deleting removes the agent and its runs", async () => {
    await page.getByRole("button", { name: "Edit Task Helper" }).click();
    const form = page.getByRole("dialog", { name: "Edit agent" });
    await form.getByLabel("Name", { exact: true }).fill("Task Helper 2");
    await form.getByRole("button", { name: "Save changes" }).click();
    await form.waitFor({ state: "hidden" });
    await page.getByRole("list", { name: "Agents" }).getByRole("heading", { name: "Task Helper 2" }).waitFor();

    const saved = (await api("/api/agents")).body.agents.find((agent) => agent.name === "Task Helper 2");
    assert.equal(saved.instructions, "Help with my tasks.");
    assert.equal(saved.maxSteps, 3);
    assert.deepEqual(saved.approvalTools, ["create_task"]);

    await page.getByRole("button", { name: "Delete Task Helper 2" }).click();
    await page.getByRole("button", { name: "Delete agent and its runs" }).click();
    await page.getByRole("heading", { name: "Task Helper 2" }).waitFor({ state: "hidden" });
    assert.equal((await api("/api/agents")).body.agents.some((agent) => agent.name === "Task Helper 2"), false);
    await page.getByText("Please list my tasks").waitFor({ state: "hidden" });
  });

  await check("agents: a duplicate of a built-in agent is editable", async () => {
    await page.getByRole("button", { name: "Duplicate Writing Agent" }).click();
    const form = page.getByRole("dialog", { name: "Duplicate agent" });
    assert.equal(await form.getByLabel("Name", { exact: true }).inputValue(), "Writing Agent (copy)");
    assert.equal(await form.getByRole("checkbox", { name: "Allow create_note" }).isChecked(), true);
    await form.getByRole("button", { name: "Create agent" }).click();
    await form.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Edit Writing Agent (copy)" }).waitFor();
  });

  await check("runs: a missing API key gives a clear next step and starts nothing", async () => {
    const before = (await api("/api/agent-runs")).body.runs.length;
    await api("/api/settings/api-key", { method: "DELETE" });
    await page.goto(`${baseUrl}/agents`);
    await page.getByRole("textbox", { name: "Objective" }).fill("hello");
    await page.getByRole("button", { name: "Run agent" }).click();
    await page.getByRole("alert").filter({ hasText: "Add your OpenRouter API key" }).waitFor();
    await page.getByRole("link", { name: "Open settings" }).waitFor();
    assert.equal((await api("/api/agent-runs")).body.runs.length, before);
    await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  });

  await check("mobile: the agents page and a run fit a phone screen", async () => {
    const run = (await api("/api/agent-runs")).body.runs[0];
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await mobile.newPage();
    for (const path of ["/agents", `/agents/runs/${run.id}`]) {
      await phone.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${path} overflows by ${overflow}px`);
    }
    await mobile.close();
  });

  await check("no uncaught errors were logged in the browser", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} agent checks passed`);
if (failed.length > 0) process.exit(1);
