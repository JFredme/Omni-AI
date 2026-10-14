// Browser test for Part 3: tasks, notes, projects, and the confirm-before-apply AI flows.
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

const dialog = (name) => page.getByRole("dialog", { name });
const tasksByTitle = async (query = "") => (await api(`/api/tasks${query}`)).body.tasks;

try {
  // Setup through the API so this suite doesn't depend on the chat suite having run first.
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });

  /* ---------------- Tasks ---------------- */

  await check("tasks: empty state, then quick add persists across reload", async () => {
    await page.goto(`${baseUrl}/tasks`);
    await page.getByText("No tasks yet").waitFor();
    await page.getByRole("textbox", { name: "Quick add task" }).fill("Write report");
    await page.keyboard.press("Enter");
    await page.getByText("Write report", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Write report", { exact: true }).waitFor();
  });

  await check("tasks: the full form validates, then creates a task with priority, due date, and tags", async () => {
    await page.getByRole("button", { name: "New task" }).first().click();
    const form = dialog("New task");
    await form.getByRole("button", { name: "Create task" }).click();
    await form.getByRole("alert").filter({ hasText: "Give the task a title" }).waitFor();

    await form.getByLabel("Title").fill("Pay rent");
    await form.getByLabel("Priority").selectOption("urgent");
    await form.getByLabel("Due date").fill("2020-01-01");
    const tags = form.getByRole("textbox", { name: "Tags" });
    await tags.fill("home");
    await tags.press("Enter");
    await form.getByRole("button", { name: "Create task" }).click();
    await form.waitFor({ state: "hidden" });

    const row = page.getByRole("listitem").filter({ hasText: "Pay rent" });
    await row.getByText("Urgent").waitFor();
    await row.getByText(/Overdue/).waitFor();
    await row.getByText("#home").waitFor();
  });

  await check("tasks: subtasks can be added and completed, and progress shows on the task", async () => {
    await page.getByText("Pay rent", { exact: true }).click();
    const form = dialog("Edit task");
    await form.getByRole("textbox", { name: "New subtask" }).fill("Find the invoice");
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await form.getByRole("checkbox", { name: "Subtask: Find the invoice" }).waitFor();
    await form.getByRole("checkbox", { name: "Subtask: Find the invoice" }).check();
    await form.getByRole("button", { name: "Save changes" }).click();
    await form.waitFor({ state: "hidden" });
    await page.getByRole("listitem").filter({ hasText: "Pay rent" }).getByText("1/1").waitFor();
  });

  await check("tasks: completing, filtering, and searching", async () => {
    await page.getByRole("checkbox", { name: 'Mark "Write report" as done' }).check();
    await waitFor(async () => (await tasksByTitle()).find((task) => task.title === "Write report")?.status === "done");

    await page.getByLabel("Filter by status").selectOption("done");
    await page.getByText("Write report", { exact: true }).waitFor();
    await page.getByText("Pay rent", { exact: true }).waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("searchbox", { name: "Search tasks" }).fill("rent");
    await page.getByText("Write report", { exact: true }).waitFor({ state: "hidden" });
    await page.getByText("Pay rent", { exact: true }).waitFor();
    await page.getByRole("searchbox", { name: "Search tasks" }).fill("zzz-nothing");
    await page.getByText("No tasks match these filters").waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByText("Write report", { exact: true }).waitFor();
  });

  await check("tasks: sorting by priority puts urgent first", async () => {
    await page.getByLabel("Sort tasks").selectOption("priority");
    await waitFor(async () => {
      const titles = await page.getByRole("list", { name: "Tasks" }).getByRole("listitem").allTextContents();
      return titles[0]?.includes("Pay rent");
    });
  });

  await check("tasks: the board moves cards with the move control and by dragging", async () => {
    await page.getByRole("button", { name: "Board" }).click();
    const todo = page.getByRole("region", { name: "To do column" });
    const progress = page.getByRole("region", { name: "In progress column" });
    const done = page.getByRole("region", { name: "Done column" });
    await todo.getByText("Pay rent").waitFor();
    await done.getByText("Write report").waitFor();

    await page.getByRole("combobox", { name: 'Move "Pay rent" to another column' }).selectOption("in_progress");
    await progress.getByText("Pay rent").waitFor();
    await waitFor(async () => (await tasksByTitle()).find((task) => task.title === "Pay rent")?.status === "in_progress");

    await page.locator('li[draggable="true"]', { hasText: "Write report" }).dragTo(progress);
    await progress.getByText("Write report").waitFor();
    await waitFor(async () => (await tasksByTitle()).find((task) => task.title === "Write report")?.status === "in_progress");
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/tasks-board.png` });
  });

  await check("tasks: deleting asks for confirmation and removes the task and its subtasks", async () => {
    await page.getByRole("button", { name: "List" }).click();
    await page.getByText("Pay rent", { exact: true }).click();
    const form = dialog("Edit task");
    await form.getByRole("button", { name: "Delete", exact: true }).click();
    await form.getByText(/Delete this task and its subtasks/).waitFor();
    await form.getByRole("button", { name: "Delete", exact: true }).click();
    await form.waitFor({ state: "hidden" });
    await page.getByText("Pay rent", { exact: true }).waitFor({ state: "hidden" });
    assert.equal((await tasksByTitle()).some((task) => task.title === "Pay rent"), false);
  });

  /* ---------------- Notes ---------------- */

  let noteId = "";
  await check("notes: empty state, then a new note autosaves and survives a reload", async () => {
    await page.goto(`${baseUrl}/notes`);
    await page.getByText("No notes yet").first().waitFor();
    await page.getByRole("button", { name: "New note" }).first().click();
    const title = page.getByRole("textbox", { name: "Note title" });
    await title.fill("Meeting notes");
    await page.getByRole("textbox", { name: "Note content" }).fill("# Kickoff\n\nWe agreed to **ship** on Friday.");
    await page.getByText("Unsaved changes…").waitFor();
    await page.getByText("All changes saved").waitFor();
    noteId = new URL(page.url()).pathname.split("/").pop();
    await waitFor(async () => (await api(`/api/notes/${noteId}`)).body.note.content.includes("ship"));

    await page.reload();
    assert.equal(await page.getByRole("textbox", { name: "Note title" }).inputValue(), "Meeting notes");
    assert.match(await page.getByRole("textbox", { name: "Note content" }).inputValue(), /We agreed to \*\*ship\*\*/);
  });

  await check("notes: Markdown renders in the preview, without raw HTML", async () => {
    await page.getByRole("textbox", { name: "Note content" }).fill("# Kickoff\n\nWe agreed to **ship** on Friday.\n\n<script>window.__pwned = true</script>");
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("heading", { name: "Kickoff" }).waitFor();
    await page.getByLabel("Preview").locator("strong", { hasText: "ship" }).waitFor();
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await page.getByText("All changes saved").waitFor();
  });

  await check("notes: folders, tags, pinning, and search", async () => {
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByRole("textbox", { name: "New folder name" }).fill("Work");
    await page.keyboard.press("Enter");
    await page.getByRole("navigation", { name: "Folders" }).getByRole("button", { name: /^Work/ }).waitFor();

    await page.getByLabel("Folder", { exact: true }).selectOption({ label: "Work" });
    await waitFor(async () => (await api(`/api/notes/${noteId}`)).body.note.folderId !== null);

    const tags = page.getByRole("textbox", { name: "Note tags" });
    await tags.fill("q3");
    await tags.press("Enter");
    await waitFor(async () => (await api(`/api/notes/${noteId}`)).body.note.tags.includes("q3"));

    await page.getByRole("button", { name: "Pin" }).click();
    await waitFor(async () => (await api(`/api/notes/${noteId}`)).body.note.pinned === true);

    await page.getByRole("button", { name: "New note" }).first().click();
    await page.getByRole("textbox", { name: "Note title" }).fill("Groceries");
    await waitFor(async () => (await api("/api/notes")).body.notes.some((note) => note.title === "Groceries"));

    await page.getByRole("searchbox", { name: "Search notes" }).fill("ship");
    const list = page.getByRole("list", { name: "Notes" });
    await list.getByText("Meeting notes").waitFor();
    await list.getByText("Groceries").waitFor({ state: "hidden" });
    await page.getByRole("searchbox", { name: "Search notes" }).fill("");

    await page.getByRole("navigation", { name: "Folders" }).getByRole("button", { name: /^Work/ }).click();
    await list.getByText("Groceries").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /^#q3 \d+$/ }).click();
    await list.getByText("Meeting notes").waitFor();
    await page.getByRole("button", { name: /^#q3 \d+$/ }).click();
    await page.getByRole("navigation", { name: "Folders" }).getByRole("button", { name: /^All notes/ }).click();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/notes.png` });
  });

  await check("notes: an AI summary changes nothing until it is inserted", async () => {
    await page.getByRole("list", { name: "Notes" }).getByText("Meeting notes").click();
    await page.getByRole("textbox", { name: "Note content" }).waitFor();
    await page.getByRole("button", { name: "Summarize" }).click();
    const review = dialog("Note summary");
    await review.getByText("Nothing is saved until you apply it", { exact: false }).waitFor();
    await review.getByLabel("Summary (you can edit it)").waitFor();
    assert.equal((await api(`/api/notes/${noteId}`)).body.note.content.includes("## Summary"), false);

    await review.getByRole("button", { name: "Discard" }).click();
    await review.waitFor({ state: "hidden" });
    assert.equal((await api(`/api/notes/${noteId}`)).body.note.content.includes("## Summary"), false);

    await page.getByRole("button", { name: "Summarize" }).click();
    const again = dialog("Note summary");
    await again.getByLabel("Summary (you can edit it)").fill("An edited summary.");
    await again.getByRole("button", { name: "#summarized" }).waitFor();
    await again.getByRole("button", { name: "Insert into note" }).click();
    await again.waitFor({ state: "hidden" });
    const saved = (await api(`/api/notes/${noteId}`)).body.note;
    assert.match(saved.content, /## Summary\n\nAn edited summary\./);
    assert.ok(saved.content.includes("We agreed to **ship**"), "the original text stays");
    assert.ok(saved.tags.includes("summarized"));
    assert.match(await page.getByRole("textbox", { name: "Note content" }).inputValue(), /An edited summary\./);
  });

  await check("notes: AI organize proposes a folder and tags, and applies only on confirmation", async () => {
    await page.getByRole("button", { name: "Organize" }).click();
    const review = dialog("Organize notes");
    await review.getByText(/Folder: Mock Folder|New folder: Mock Folder/).waitFor();
    assert.equal((await api("/api/notes/meta")).body.folders.some((folder) => folder.name === "Mock Folder"), false);
    await review.getByRole("button", { name: /Apply 1 change/ }).click();
    await review.getByText("Organized 1 note.").waitFor();
    await review.getByRole("button", { name: "Done" }).click();
    assert.equal((await api("/api/notes/meta")).body.folders.some((folder) => folder.name === "Mock Folder"), true);
    const notes = (await api("/api/notes")).body.notes;
    assert.ok(notes.some((note) => note.tags.includes("mocked")));
  });

  await check("notes: deleting asks for confirmation", async () => {
    await page.getByRole("list", { name: "Notes" }).getByText("Groceries").click();
    await page.getByRole("textbox", { name: "Note content" }).waitFor();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByText("Delete this note?").waitFor();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByText("Select a note").waitFor();
    assert.equal((await api("/api/notes")).body.notes.some((note) => note.title === "Groceries"), false);
  });

  /* ---------------- Projects ---------------- */

  let projectId = "";
  await check("projects: create a project and see its dashboard", async () => {
    await page.goto(`${baseUrl}/projects`);
    await page.getByText("No active projects").waitFor();
    await page.getByRole("button", { name: "New project" }).first().click();
    const form = dialog("New project");
    await form.getByRole("button", { name: "Create project" }).click();
    await form.getByRole("alert").filter({ hasText: "Give the project a name" }).waitFor();
    await form.getByLabel("Name").fill("Website redesign");
    await form.getByLabel("Description").fill("Refresh the marketing site before launch.");
    await form.getByLabel("Status").selectOption("active");
    await form.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("heading", { name: "Website redesign", level: 1 }).waitFor();
    projectId = new URL(page.url()).pathname.split("/").pop();
    await page.getByText("No milestones yet").waitFor();
    await page.getByText("No tasks in this project yet").waitFor();
    assert.equal(await page.getByRole("progressbar", { name: "Project progress" }).getAttribute("aria-valuenow"), "0");
  });

  await check("projects: milestones and linked tasks drive the progress numbers", async () => {
    await page.getByRole("button", { name: "Add milestone" }).click();
    const milestone = dialog("New milestone");
    await milestone.getByLabel("Title").fill("Design approved");
    await milestone.getByLabel("Target date").fill("2030-02-01");
    await milestone.getByRole("button", { name: "Add milestone" }).click();
    await page.getByText("Design approved").waitFor();

    const quick = page.getByRole("textbox", { name: "Quick add task to project" });
    await quick.fill("Sketch layouts");
    await quick.press("Enter");
    await quick.fill("Choose fonts");
    await quick.press("Enter");
    await page.getByText("Choose fonts", { exact: true }).waitFor();

    await page.getByRole("checkbox", { name: 'Mark "Sketch layouts" as done' }).check();
    await waitFor(async () => (await page.getByRole("progressbar", { name: "Project progress" }).getAttribute("aria-valuenow")) === "50");

    await page.getByRole("checkbox", { name: 'Mark "Choose fonts" as done' }).check();
    await waitFor(async () => (await page.getByRole("progressbar", { name: "Project progress" }).getAttribute("aria-valuenow")) === "100");

    await page.getByRole("checkbox", { name: /Mark milestone "Design approved" complete/ }).check();
    await page.getByText("(1/1)").waitFor();
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/project-dashboard.png`, fullPage: true });
  });

  await check("projects: an AI plan is reviewed first, and only ticked items are saved", async () => {
    await page.getByRole("button", { name: "Generate plan" }).click();
    await dialog("Generate a project plan").getByLabel("Anything specific to focus on? (optional)").fill("Launch soon");
    await dialog("Generate a project plan").getByRole("button", { name: "Generate plan" }).click();

    const review = dialog("Project plan");
    await review.getByText("Mock research task").waitFor();
    await review.getByText("Research done").first().waitFor();
    await review.getByText("Read docs").waitFor();

    const before = await tasksByTitle(`?projectId=${projectId}`);
    assert.equal(before.some((task) => task.title.startsWith("Mock ")), false, "nothing is saved before confirming");
    assert.equal((await api(`/api/projects/${projectId}`)).body.project.milestones.some((m) => m.title === "Research done"), false);

    await review.getByRole("checkbox", { name: "Task: Mock build task" }).uncheck();
    await review.getByRole("button", { name: "Apply 2 items" }).click();
    await review.getByText("Added 1 task and 1 milestone.").waitFor();
    await review.getByRole("button", { name: "Done" }).click();

    const after = await tasksByTitle(`?projectId=${projectId}`);
    const research = after.find((task) => task.title === "Mock research task");
    assert.ok(research, "the ticked task was saved");
    assert.equal(research.priority, "high");
    assert.equal(research.milestoneTitle, "Research done");
    assert.deepEqual(research.subtasks.map((subtask) => subtask.title), ["Read docs"]);
    assert.equal(after.some((task) => task.title === "Mock build task"), false, "the unticked task was not saved");
    await page.getByText("Mock research task", { exact: true }).waitFor();
  });

  await check("projects: breaking a project into tasks proposes tasks only", async () => {
    await page.getByRole("button", { name: "Break into tasks" }).click();
    await dialog("Break this project into tasks").getByRole("button", { name: "Suggest tasks" }).click();
    const review = dialog("Project plan");
    await review.getByText("Mock step one").waitFor();
    assert.equal(await review.getByText("Milestones", { exact: true }).count(), 0);
    await review.getByRole("button", { name: /Apply 2 items/ }).click();
    await review.getByText("Added 2 tasks.").waitFor();
    await review.getByRole("button", { name: "Done" }).click();
    await page.getByText("Mock step two", { exact: true }).waitFor();
  });

  await check("projects: the list shows progress, and status changes persist", async () => {
    await page.goto(`${baseUrl}/projects`);
    const card = page.getByRole("link", { name: /Website redesign/ });
    await card.waitFor();
    await card.getByRole("progressbar").waitFor();
    await card.click();
    await page.getByLabel("Project status").selectOption("on_hold");
    await waitFor(async () => (await api(`/api/projects/${projectId}`)).body.project.status === "on_hold");
  });

  /* ---------------- AI on tasks ---------------- */

  await check("ai: suggested priorities are shown, then applied only on confirmation", async () => {
    const created = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Renew passport", priority: "low" }) });
    const taskId = created.body.task.id;
    await page.goto(`${baseUrl}/tasks`);
    await page.getByText("Renew passport", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Suggest priorities" }).click();
    const review = dialog("Suggested priorities");
    await review.getByText("It is the most pressing.").waitFor();
    assert.equal((await api(`/api/tasks/${taskId}`)).body.task.priority, "low", "unchanged before confirming");

    await review.getByRole("button", { name: "Discard" }).click();
    await review.waitFor({ state: "hidden" });
    assert.equal((await api(`/api/tasks/${taskId}`)).body.task.priority, "low", "unchanged after discarding");

    await page.getByRole("button", { name: "Suggest priorities" }).click();
    const again = dialog("Suggested priorities");
    await again.getByRole("button", { name: "Apply 1 change" }).click();
    await again.getByText("Updated 1 task.").waitFor();
    await again.getByRole("button", { name: "Done" }).click();
    assert.equal((await api(`/api/tasks/${taskId}`)).body.task.priority, "urgent");
    await page.getByRole("listitem").filter({ hasText: "Renew passport" }).getByText("Urgent").waitFor();
  });

  await check("ai: organizing tasks proposes a project and tags", async () => {
    await page.getByRole("button", { name: "Organize" }).click();
    const review = dialog("Organize tasks");
    await review.getByText(/Move to Website redesign/).waitFor();
    await review.getByText("+#organized").waitFor();
    await review.getByRole("button", { name: "Apply 1 change" }).click();
    await review.getByText("Organized 1 task.").waitFor();
    await review.getByRole("button", { name: "Done" }).click();
    const organized = (await tasksByTitle()).filter((task) => task.tags.includes("organized"));
    assert.equal(organized.length, 1);
    assert.equal(organized[0].projectName, "Website redesign");
  });

  await check("ai: usage is recorded for every request, and a missing key gives a clear next step", async () => {
    const usage = (await api("/api/usage")).body;
    assert.ok(usage.totals.requests >= 6, `expected AI requests in usage, got ${usage.totals.requests}`);

    await api("/api/settings/api-key", { method: "DELETE" });
    await page.getByRole("button", { name: "Suggest priorities" }).click();
    const review = dialog("AI assistant");
    await review.getByRole("alert").filter({ hasText: "Add your OpenRouter API key" }).waitFor();
    await review.getByRole("link", { name: "Open settings" }).waitFor();
    await review.getByRole("button", { name: "Close", exact: true }).click();
    await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  });

  await check("ai: a spending limit blocks proposals with a specific message", async () => {
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ monthlyBudgetUsd: 0.000001 }) });
    await page.getByRole("button", { name: "Suggest priorities" }).click();
    await dialog("AI assistant").getByRole("alert").filter({ hasText: "Monthly spending limit reached" }).waitFor();
    await dialog("AI assistant").getByRole("button", { name: "Close", exact: true }).click();
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ monthlyBudgetUsd: null }) });
  });

  /* ---------------- Projects: deletion ---------------- */

  await check("projects: deleting keeps the tasks but removes the project and its milestones", async () => {
    await page.goto(`${baseUrl}/projects/${projectId}`);
    await page.getByRole("button", { name: "Delete project" }).click();
    await page.getByText(/Its tasks are kept/).waitFor();
    await page.getByRole("button", { name: "Delete project" }).last().click();
    await page.waitForURL(`${baseUrl}/projects`);
    assert.equal((await api(`/api/projects/${projectId}`)).status, 404);
    assert.ok((await tasksByTitle()).some((task) => task.title === "Sketch layouts" && task.projectId === null));
    await page.goto(`${baseUrl}/projects/${projectId}`);
    await page.getByText("Project not found").waitFor();
  });

  /* ---------------- Responsive ---------------- */

  await check("mobile: tasks, notes, and projects fit the screen without sideways scrolling", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await mobile.newPage();
    for (const path of ["/tasks", "/notes", "/projects"]) {
      await phone.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${path} overflows by ${overflow}px`);
    }
    await phone.goto(`${baseUrl}/tasks`, { waitUntil: "networkidle" });
    await phone.getByRole("button", { name: "New task" }).first().click();
    const sheet = phone.getByRole("dialog", { name: "New task" });
    await sheet.waitFor();
    const box = await sheet.boundingBox();
    assert.ok(box && box.width <= 390, "the task dialog fits a phone");
    if (screenshotDir) await phone.screenshot({ path: `${screenshotDir}/tasks-mobile.png` });
    await mobile.close();
  });

  await check("no uncaught errors were logged in the browser", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} productivity checks passed`);
if (failed.length > 0) process.exit(1);
