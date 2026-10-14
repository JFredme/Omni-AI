// Browser test for the chat extras: code blocks, attachments, editing, branches, export, summary, model comparison.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
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
const setModel = (id) => api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: id }) });
async function newChatAndSend(text) {
  await page.goto(`${baseUrl}/chat`);
  const box = page.getByPlaceholder(/Message/);
  await box.waitFor();
  await box.fill(text);
  await box.press("Enter");
}

try {
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await setModel("mock/free-model");

  await check("code blocks are highlighted, labelled with the language, and copyable", async () => {
    await newChatAndSend("please show code");
    await page.getByText("Done.").waitFor({ timeout: 20_000 });
    const block = page.locator("pre").first();
    await block.locator(".hljs-keyword").first().waitFor();
    await block.locator(".hljs-comment").first().waitFor();
    await page.getByText("js", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Copy code" }).click();
    await page.getByRole("button", { name: "Copied code" }).waitFor();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /^const answer = 42;/);
    assert.ok(!clip.includes("hljs"), "the copied text is plain code, not markup");
  });

  await check("editing a message makes a new version and keeps the original one click away", async () => {
    await newChatAndSend("first draft question");
    await page.getByText("Hello from the mock model.").waitFor({ timeout: 20_000 });
    const mine = page.locator("div.group").filter({ hasText: "first draft question" }).first();
    await mine.hover();
    await mine.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Edit your message").fill("second draft question compare");
    await page.getByRole("button", { name: "Send new version" }).click();
    await page.getByText("second draft question compare").waitFor();
    await page.getByText(/Answer from mock\/free-model/).waitFor({ timeout: 20_000 });
    assert.equal(await page.locator("div.group").filter({ hasText: "first draft question" }).count(), 0, "the old version is hidden");
    await page.getByRole("group", { name: "Versions of this message" }).first().getByText("2/2").waitFor();
    await page.getByRole("button", { name: "Previous version" }).first().click();
    await page.locator("div.group").filter({ hasText: "first draft question" }).waitFor();
    await page.getByText("Hello from the mock model.").waitFor();
    assert.equal(await page.locator("div.group").filter({ hasText: "second draft question compare" }).count(), 0);
    await page.getByRole("button", { name: "Next version" }).first().click();
    await page.locator("div.group").filter({ hasText: "second draft question compare" }).waitFor();
    // Both versions survive a reload.
    await page.reload();
    await page.locator("div.group").filter({ hasText: "second draft question compare" }).waitFor();
    await page.getByRole("button", { name: "Previous version" }).first().click();
    await page.locator("div.group").filter({ hasText: "first draft question" }).waitFor();
  });

  await check("regenerating keeps the earlier answer as a version", async () => {
    await newChatAndSend("Say hello again");
    await page.getByText("Hello from the mock model.").waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Regenerate" }).click();
    await page.getByRole("group", { name: "Versions of this message" }).getByText("2/2").waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Previous version" }).click();
    await page.getByRole("group", { name: "Versions of this message" }).getByText("1/2").waitFor();
  });

  await check("images go to vision models: attach, preview, answer, and it persists", async () => {
    await setModel("mock/pro-model");
    await page.goto(`${baseUrl}/chat`);
    await page.getByPlaceholder(/Message/).waitFor();
    await page.getByLabel("Attach files").first().setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("list", { name: "Attached files" }).getByText("invoice.png").waitFor();
    await page.getByPlaceholder(/Message/).fill("what does this say?");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(/Text in image: INVOICE 4821/).waitFor({ timeout: 20_000 });
    const thumb = page.getByRole("img", { name: "invoice.png" });
    await thumb.waitFor();
    assert.ok(await thumb.evaluate((img) => img.complete && img.naturalWidth > 0), "the image is served back and displays");
    await page.reload();
    await page.getByRole("img", { name: "invoice.png" }).waitFor();
  });

  await check("a document is read and its text goes to the model", async () => {
    await page.goto(`${baseUrl}/chat`);
    await page.getByPlaceholder(/Message/).waitFor();
    await page.getByLabel("Attach files").first().setInputFiles({ name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("# Launch plan\n\nShip the beta on Friday.") });
    await page.getByRole("list", { name: "Attached files" }).getByText("plan.md").waitFor();
    await page.getByPlaceholder(/Message/).fill("summarize the file");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(/I read the attachment plan\.md: .*Ship the beta on Friday/).waitFor({ timeout: 20_000 });
    await page.getByRole("link", { name: "plan.md" }).waitFor();
  });

  await check("a text-only model refuses images with a clear reason, and files can be removed", async () => {
    await setModel("mock/free-model");
    await page.goto(`${baseUrl}/chat`);
    await page.getByPlaceholder(/Message/).waitFor();
    await page.getByLabel("Attach files").first().setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("alert").filter({ hasText: /can't read images/ }).waitFor();
    await page.getByLabel("Attach files").first().setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("just text") });
    await page.getByRole("button", { name: "Remove note.txt" }).click();
    assert.equal(await page.getByRole("list", { name: "Attached files" }).count(), 0);
  });

  await check("bad attachments are rejected by the server", async () => {
    const send = async (name, type, body) => {
      const form = new FormData();
      form.append("file", new Blob([body], { type }), name);
      const response = await retryingFetch(`${baseUrl}/api/attachments`, { method: "POST", headers: sessionHeaders(), body: form });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await send("a.exe", "application/octet-stream", "MZ")).body.error.code, "unsupported_type");
    assert.equal((await send("fake.png", "image/png", "not a png")).body.error.code, "invalid_file");
    assert.equal((await send("big.png", "image/png", Buffer.alloc(6 * 1024 * 1024))).status, 413);
    const missing = await api("/api/attachments/does-not-exist");
    assert.equal(missing.status, 404);
  });

  await check("attachments are only served to signed-in users, with a sandbox policy", async () => {
    const detail = (await api("/api/conversations")).body.conversations;
    let attachmentId = null;
    for (const conversation of detail) {
      const messages = (await api(`/api/conversations/${conversation.id}`)).body.conversation.messages;
      attachmentId = messages.flatMap((m) => m.attachments).find((a) => a.kind === "image")?.id ?? attachmentId;
    }
    assert.ok(attachmentId, "an image attachment exists");
    const signedOut = await fetch(`${baseUrl}/api/attachments/${attachmentId}`);
    assert.equal(signedOut.status, 401);
    const signedIn = await retryingFetch(`${baseUrl}/api/attachments/${attachmentId}`, { headers: sessionHeaders() });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.headers.get("content-type"), "image/png");
    assert.match(signedIn.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal(signedIn.headers.get("x-content-type-options"), "nosniff");
  });

  await check("a conversation can be exported as Markdown, text and JSON", async () => {
    await setModel("mock/free-model");
    await newChatAndSend("Say hello for export");
    await page.getByText("Glad to help.").waitFor({ timeout: 20_000 });
    await page.getByText("More", { exact: true }).click();
    const link = page.getByRole("link", { name: "Markdown" });
    await link.waitFor();
    const id = page.url().split("/").pop();
    const md = await retryingFetch(`${baseUrl}/api/conversations/${id}/export?format=md`, { headers: sessionHeaders() });
    assert.match(md.headers.get("content-disposition") ?? "", /attachment; filename="say-hello-for-export\.md"/);
    const body = await md.text();
    assert.match(body, /## You\n\nSay hello for export/);
    assert.match(body, /Glad to help\./);
    const json = await (await retryingFetch(`${baseUrl}/api/conversations/${id}/export?format=json`, { headers: sessionHeaders() })).json();
    assert.equal(json.messages.length, 2);
    assert.equal((await api(`/api/conversations/${id}/export?format=pdf`)).status, 400);
  });

  await check("summarize shows a summary, then saves a note and tasks only when asked", async () => {
    const before = (await api("/api/tasks")).body.tasks.length;
    await page.keyboard.press("Escape");
    await page.getByText("More", { exact: true }).click();
    await page.getByRole("button", { name: "Summarize this chat" }).click();
    const dialog = page.getByRole("dialog", { name: "Summary of this chat" });
    await dialog.getByText("A short mock summary of the chat.").waitFor({ timeout: 20_000 });
    assert.equal((await api("/api/tasks")).body.tasks.length, before, "nothing is saved until you choose");
    await dialog.getByRole("button", { name: "Add selected as tasks" }).click();
    await dialog.getByRole("button", { name: "Added 1 task" }).waitFor();
    assert.ok((await api("/api/tasks")).body.tasks.some((t) => t.title === "Follow up on the mock chat"));
    await dialog.getByRole("button", { name: "Save as note" }).click();
    await dialog.getByRole("link", { name: "Open the note" }).waitFor();
    const notes = (await api("/api/notes")).body.notes;
    assert.ok(notes.some((n) => n.title.startsWith("Summary: ")));
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  });

  await check("model comparison streams several answers side by side with timing and cost", async () => {
    await page.goto(`${baseUrl}/chat/compare`);
    await page.getByRole("heading", { name: "Compare models", level: 1 }).waitFor();
    await page.getByRole("button", { name: "Choose a model" }).first().click();
    await page.getByRole("listbox", { name: "Models" }).getByText("Mock Free").click();
    await page.getByRole("button", { name: "Choose a model" }).first().click();
    await page.getByRole("listbox", { name: "Models" }).getByText("Mock Pro").click();
    await page.getByText("images").first().waitFor();
    await page.getByLabel("Prompt").fill("compare yourselves");
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await page.getByRole("article", { name: "Answer from Mock Free" }).getByText("Answer from mock/free-model.").waitFor({ timeout: 20_000 });
    await page.getByRole("article", { name: "Answer from Mock Pro" }).getByText("Answer from mock/pro-model.").waitFor();
    await page.getByRole("article", { name: "Answer from Mock Pro" }).getByText(/\$0\.0|cost unknown/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Compare", exact: true }).isEnabled(), true);
  });

  await check("comparison needs two different models", async () => {
    const one = await api("/api/compare", { method: "POST", body: JSON.stringify({ prompt: "x", modelIds: ["mock/free-model", "mock/free-model"] }) });
    assert.equal(one.status, 400);
    assert.equal(one.body.error.code, "invalid_models");
  });

  await check("mobile: the chat toolbar and compare page fit a phone screen", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    for (const path of ["/chat", "/chat/compare"]) {
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
console.log(`\n${results.length - failed.length}/${results.length} chat-extras checks passed`);
process.exit(failed.length ? 1 : 0);
