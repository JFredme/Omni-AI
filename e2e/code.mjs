// Browser test for the code workspace: projects, files, the editor, the assistant with diffs, and the (Docker-gated) Run.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
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
const editorReady = () => page.locator(".monaco-editor").first().waitFor({ timeout: 30_000 });
const files = async (projectId) => (await api(`/api/code/projects/${projectId}/files`)).body.files;
let projectId;

try {
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });

  await check("code: starts empty, then a project and a file can be created from the page", async () => {
    await page.goto(`${baseUrl}/code`);
    await page.getByRole("heading", { name: "Workspace", level: 1 }).waitFor();
    await page.getByText("No projects yet").waitFor();
    await page.getByRole("button", { name: "Create a project" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Demo");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("combobox", { name: "Project" }).waitFor();
    projectId = (await api("/api/code/projects")).body.projects[0].id;
    await page.getByRole("button", { name: "New file" }).click();
    await page.getByLabel("Path").fill("main.py");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("tree").getByRole("button", { name: "main.py", exact: true }).waitFor();
    await editorReady();
    assert.equal((await files(projectId)).length, 1);
  });

  await check("code: bad file names are refused with a reason, before anything is created", async () => {
    await page.getByRole("button", { name: "New file" }).click();
    for (const [name, reason] of [["../escape.py", /can't contain/], ["has space.py", /letters, numbers/], ["/abs.py", /relative path/]]) {
      await page.getByLabel("Path").fill(name);
      await page.getByRole("alert").getByText(reason).waitFor();
      assert.equal(await page.getByRole("button", { name: "Create", exact: true }).isDisabled(), true);
    }
    await page.getByLabel("Path").fill("main.py");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("alert").getByText("already exists").waitFor();
    await page.getByRole("button", { name: "Cancel" }).click();
    assert.equal((await files(projectId)).length, 1);
  });

  await check("code: typing in the editor autosaves, and the file is there after a reload", async () => {
    await editorReady();
    await page.locator(".monaco-editor").first().click();
    await page.keyboard.type("answer = 42");
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 15_000 });
    const [file] = await files(projectId);
    const saved = (await api(`/api/code/files/${file.id}`)).body.file;
    assert.equal(saved.content, "answer = 42");
    await page.reload();
    await editorReady();
    await page.locator(".view-line", { hasText: "answer = 42" }).waitFor();
  });

  await check("code: nested files appear in folders, and can be renamed and deleted after confirmation", async () => {
    await api(`/api/code/projects/${projectId}/files`, { method: "POST", body: JSON.stringify({ path: "src/util/helpers.js", content: "export const x = 1;\n" }) });
    await page.reload();
    const tree = page.getByRole("tree");
    await tree.getByRole("button", { name: "src", exact: true }).waitFor();
    await tree.getByRole("button", { name: "helpers.js", exact: true }).click();
    await page.locator(".view-line", { hasText: "export const x" }).waitFor();
    await tree.getByRole("button", { name: "src", exact: true }).click();
    assert.equal(await tree.getByRole("button", { name: "helpers.js", exact: true }).count(), 0, "the folder collapses");
    await tree.getByRole("button", { name: "src", exact: true }).click();

    await page.getByRole("button", { name: "Rename src/util/helpers.js" }).click({ force: true });
    await page.getByLabel("Path").fill("src/util/tools.js");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await tree.getByRole("button", { name: "tools.js", exact: true }).waitFor();
    await page.getByRole("button", { name: "Delete src/util/tools.js" }).click({ force: true });
    await page.getByRole("dialog", { name: "Delete this file?" }).getByRole("button", { name: "Cancel" }).click();
    assert.equal((await files(projectId)).length, 2);
    await page.getByRole("button", { name: "Delete src/util/tools.js" }).click({ force: true });
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await tree.getByRole("button", { name: "tools.js", exact: true }).waitFor({ state: "detached" });
    assert.equal((await files(projectId)).length, 1);
  });

  await check("code: Run is honest about needing Docker, and the server refuses to run anything without it", async () => {
    await tree().getByRole("button", { name: "main.py", exact: true }).click();
    await editorReady();
    const status = (await api("/api/code/status")).body;
    if (status.available) {
      await page.getByRole("button", { name: "Run" }).waitFor();
      return;
    }
    assert.equal(await page.getByRole("button", { name: "Run" }).isDisabled(), true);
    await page.getByText("Run is switched off.").waitFor();
    await page.getByText("Omni never runs code directly on this computer.").waitFor();
    const run = await api(`/api/code/projects/${projectId}/run`, { method: "POST", body: JSON.stringify({ entry: "main.py" }) });
    assert.equal(run.status, 503);
    assert.equal(run.body.error.code, "sandbox_unavailable");
    assert.match(run.body.error.message, /Docker/);
  });

  await check("code: the run API validates what it's asked to run", async () => {
    const missing = await api(`/api/code/projects/${projectId}/run`, { method: "POST", body: JSON.stringify({ entry: "nope.py" }) });
    assert.equal(missing.status, 404);
    await api(`/api/code/projects/${projectId}/files`, { method: "POST", body: JSON.stringify({ path: "notes.md", content: "# hi" }) });
    const notRunnable = await api(`/api/code/projects/${projectId}/run`, { method: "POST", body: JSON.stringify({ entry: "notes.md" }) });
    assert.equal(notRunnable.status, 400);
    assert.equal(notRunnable.body.error.code, "cannot_run");
    const traversal = await api(`/api/code/projects/${projectId}/run`, { method: "POST", body: JSON.stringify({ entry: "../../etc/passwd" }) });
    assert.equal(traversal.status, 404, "an entry that isn't one of the project's files is never run");
    assert.equal((await api(`/api/code/projects/${projectId}/files`, { method: "POST", body: JSON.stringify({ path: "../x.py" }) })).status, 400);
  });

  await check("code: the assistant explains a file without changing it", async () => {
    await page.getByRole("tab", { name: "Assistant" }).click();
    await page.getByRole("button", { name: "Ask" }).click();
    await page.getByRole("region", { name: "Assistant reply" }).or(page.getByLabel("Assistant reply")).getByText("This file prints a greeting.").waitFor({ timeout: 30_000 });
    const [file] = (await files(projectId)).filter((f) => f.path === "main.py");
    assert.equal((await api(`/api/code/files/${file.id}`)).body.file.content, "answer = 42");
  });

  await check("code: an edit is shown as a diff and changes nothing until applied", async () => {
    await page.getByLabel("What should it do?").selectOption("edit");
    await page.getByLabel("Describe the change").fill("add a header comment");
    await page.getByRole("button", { name: "Ask" }).click();
    await page.getByText("Added a header comment as asked.").waitFor({ timeout: 30_000 });
    await page.getByText("Proposed change").waitFor();
    await page.locator(".monaco-diff-editor").waitFor({ timeout: 30_000 });
    const main = (await files(projectId)).find((f) => f.path === "main.py");
    assert.equal((await api(`/api/code/files/${main.id}`)).body.file.content, "answer = 42", "not saved while reviewing");

    await page.getByRole("button", { name: "Discard" }).click();
    assert.equal(await page.getByText("Proposed change").count(), 0);

    await page.getByRole("button", { name: "Ask" }).click();
    await page.getByRole("button", { name: "Apply to this file" }).click();
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal((await api(`/api/code/files/${main.id}`)).body.file.content, "# reviewed by the assistant\nanswer = 42");
    await page.locator(".view-line", { hasText: "reviewed by the assistant" }).waitFor();
  });

  await check("code: written tests are offered as a new file with a name you choose", async () => {
    await page.getByRole("tab", { name: "Assistant" }).click();
    await page.getByLabel("What should it do?").selectOption("tests");
    await page.getByRole("button", { name: "Ask" }).click();
    await page.getByText("Proposed test file").waitFor({ timeout: 30_000 });
    assert.equal(await page.getByLabel("Save as").inputValue(), "main.test.py");
    await page.getByLabel("Save as").fill("main.py");
    await page.getByRole("alert").getByText("already exists").waitFor();
    assert.equal(await page.getByRole("button", { name: "Create this file" }).isDisabled(), true);
    await page.getByLabel("Save as").fill("test_main.py");
    await page.getByRole("button", { name: "Create this file" }).click();
    await page.getByRole("tree").getByRole("button", { name: "test_main.py", exact: true }).waitFor();
    const created = (await files(projectId)).find((f) => f.path === "test_main.py");
    assert.match((await api(`/api/code/files/${created.id}`)).body.file.content, /import unittest/);
  });

  await check("code: projects can be renamed and deleted after confirmation, taking their files along", async () => {
    await page.getByRole("button", { name: "Rename project" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Demo renamed");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await page.getByRole("combobox", { name: "Project" }).selectOption({ label: "Demo renamed" });
    await page.getByRole("button", { name: "Delete project" }).click();
    await page.getByRole("dialog", { name: "Delete this project?" }).getByRole("button", { name: "Cancel" }).click();
    assert.equal((await api("/api/code/projects")).body.projects.length, 1);
    await page.getByRole("button", { name: "Delete project" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.getByText("No projects yet").waitFor();
    assert.equal((await api("/api/code/projects")).body.projects.length, 0);
    assert.equal((await api(`/api/code/projects/${projectId}/files`)).status, 404);
  });

  await check("code: the API needs a sign-in and rejects oversized or binary files", async () => {
    assert.equal((await fetch(`${baseUrl}/api/code/projects`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/code/status`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/code/assist`, { method: "POST", body: "{}" })).status, 401);
    const project = (await api("/api/code/projects", { method: "POST", body: JSON.stringify({ name: "Limits" }) })).body.project;
    const big = await api(`/api/code/projects/${project.id}/files`, { method: "POST", body: JSON.stringify({ path: "big.txt", content: "x".repeat(600 * 1024) }) });
    assert.equal(big.status, 413);
    const binary = await api(`/api/code/projects/${project.id}/files`, { method: "POST", body: JSON.stringify({ path: "bin.txt", content: "a\u0000b" }) });
    assert.equal(binary.body.error.code, "binary_file");
    await api(`/api/code/projects/${project.id}`, { method: "DELETE" });
  });

  await check("mobile: the workspace fits a phone screen", async () => {
    const project = (await api("/api/code/projects", { method: "POST", body: JSON.stringify({ name: "Phone" }) })).body.project;
    await api(`/api/code/projects/${project.id}/files`, { method: "POST", body: JSON.stringify({ path: "a.py", content: "print('x')\n" }) });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    await phone.goto(`${baseUrl}/code`, { waitUntil: "networkidle" });
    await phone.locator(".monaco-editor").first().waitFor({ timeout: 30_000 });
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `overflows by ${overflow}px`);
    await mobile.close();
    await api(`/api/code/projects/${project.id}`, { method: "DELETE" });
  });

  await check("no unexpected browser errors", async () => {
    assert.deepEqual(errors, [], errors.join("\n"));
  });
} finally {
  await browser.close();
}

function tree() {
  return page.getByRole("tree");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} code checks passed`);
process.exit(failed.length ? 1 : 0);
