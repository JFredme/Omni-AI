// Browser test for the knowledge base and memory: uploads, search, citations in chat, memory, safety checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";
const fixture = (name) => readFileSync(new URL(`../src/lib/knowledge/fixtures/${name}`, import.meta.url));
// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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

const HANDBOOK = `# Employee handbook

## Vacation

Employees get twenty-five vacation days per year. Unused vacation days roll over into the next year.

## Equipment

Laptops are replaced every three years. Report broken equipment to the facilities desk.`;

async function chatAsk(question) {
  await page.goto(`${baseUrl}/chat`);
  const box = page.getByPlaceholder(/Message/);
  await box.waitFor();
  await box.fill(question);
  await box.press("Enter");
}

try {
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });

  await check("knowledge: starts empty with a helpful message", async () => {
    await page.goto(`${baseUrl}/knowledge`);
    await page.getByRole("heading", { name: "Everything you've saved", level: 1 }).waitFor();
    await page.getByText("Nothing here yet").waitFor();
    await page.getByRole("tab", { name: "Documents", selected: true }).waitFor();
  });

  await check("knowledge: uploads Markdown, PDF, Word and spreadsheet files and indexes them", async () => {
    const input = page.getByLabel("Choose files to add");
    await input.setInputFiles([
      { name: "handbook.md", mimeType: "text/markdown", buffer: Buffer.from(HANDBOOK) },
      { name: "report.pdf", mimeType: "application/pdf", buffer: fixture("sample.pdf") },
      { name: "festival.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: fixture("sample.docx") },
      { name: "sales.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fixture("sample.xlsx") },
    ]);
    const list = page.getByRole("heading", { name: /Your documents/ });
    await page.getByText("Your documents · 4").waitFor({ timeout: 20_000 });
    for (const name of ["handbook.md", "report.pdf", "festival.docx", "sales.xlsx"]) {
      await page.getByRole("link", { name, exact: true }).waitFor();
    }
    // Wait for the background indexing to finish.
    await page.getByText("Ready", { exact: true }).nth(3).waitFor({ timeout: 20_000 });
    await list.waitFor();
    const docs = (await api("/api/knowledge")).body.documents;
    assert.deepEqual(docs.map((d) => d.kind).sort(), ["docx", "markdown", "pdf", "xlsx"]);
    assert.ok(docs.every((d) => d.embeddedCount === d.chunkCount && d.chunkCount > 0));
  });

  await check("knowledge: refuses files it can't read, and says why", async () => {
    await page.getByLabel("Choose files to add").setInputFiles([
      { name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ binary") },
      { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is plain text, not a pdf") },
    ]);
    await page.getByRole("alert").filter({ hasText: /aren't supported/ }).waitFor();
    await page.getByRole("alert").filter({ hasText: /doesn't look like a real \.pdf/ }).waitFor();
    assert.equal((await api("/api/knowledge")).body.documents.length, 4);
  });

  await check("knowledge: search finds the right passage, with its page number and highlighted words", async () => {
    await page.getByLabel("Search your knowledge").fill("when was the glacier survey completed");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const first = page.getByRole("list").filter({ has: page.getByRole("link", { name: "report.pdf" }) }).first();
    await first.waitFor();
    await page.getByText("searched by meaning").waitFor();
    await page.getByText("page 2").first().waitFor();
    await page.locator("mark", { hasText: /glacier/i }).first().waitFor();
    await page.getByText(/% match/).first().waitFor();
  });

  await check("knowledge: pasted text becomes a document", async () => {
    await page.getByRole("button", { name: "Paste text" }).click();
    await page.getByLabel("Title").fill("Lunch order");
    await page.getByLabel("Text", { exact: true }).fill("On Fridays the team orders dumplings from the corner restaurant.");
    await page.getByRole("button", { name: "Add to knowledge" }).click();
    await page.getByRole("link", { name: "Lunch order" }).waitFor();
  });

  await check("knowledge: an image is read by the model and becomes searchable text", async () => {
    await page.getByLabel("Choose files to add").setInputFiles([{ name: "invoice.png", mimeType: "image/png", buffer: PNG }]);
    await page.getByRole("link", { name: "invoice.png" }).waitFor({ timeout: 20_000 });
    const doc = (await api("/api/knowledge")).body.documents.find((d) => d.name === "invoice.png");
    assert.equal(doc.kind, "image");
    assert.match(doc.error ?? "", /written by an AI model/);
    const chunks = (await api(`/api/knowledge/${doc.id}`)).body.chunks;
    assert.ok(chunks.some((c) => c.content.includes("INVOICE 4821")));
  });

  await check("knowledge: chat answers from documents and shows numbered, openable sources", async () => {
    await chatAsk("How many vacation days do employees get?");
    const reply = page.locator("main").getByText(/According to your documents \[1\]/);
    await reply.waitFor({ timeout: 20_000 });
    const chip = page.getByRole("button", { name: /1\s*handbook\.md/ });
    await chip.waitFor();
    assert.match((await chip.getAttribute("title")) ?? "", /Cited in the reply/);
    await chip.click();
    await page.getByText(/twenty-five vacation days/).last().waitFor();
    await page.getByRole("link", { name: "Open document" }).click();
    await page.waitForURL(/\/knowledge\/[^/]+$/);
    await page.getByRole("heading", { name: "handbook.md", level: 1 }).waitFor();
    await page.getByText(/twenty-five vacation days/).first().waitFor();
  });

  await check("knowledge: sources stay with the message after a reload", async () => {
    const conversations = (await api("/api/conversations")).body.conversations;
    const asked = conversations.find((c) => c.title.startsWith("How many vacation"));
    assert.ok(asked, "the conversation was saved");
    await page.goto(`${baseUrl}/chat/${asked.id}`);
    await page.getByRole("button", { name: /1\s*handbook\.md/ }).waitFor();
    const saved = (await api(`/api/conversations/${asked.id}`)).body.conversation.messages.at(-1);
    assert.equal(saved.citations[0].name, "handbook.md");
    assert.equal(saved.citations[0].page, null);
  });

  await check("knowledge: turning Knowledge off stops documents being used", async () => {
    await page.goto(`${baseUrl}/chat`);
    await page.getByRole("button", { name: /Knowledge on/ }).click();
    await page.getByRole("button", { name: /Knowledge off/ }).waitFor();
    const box = page.getByPlaceholder(/Message/);
    await box.fill("What are the equipment replacement rules?");
    await box.press("Enter");
    await page.getByText("Hello from the mock model.").waitFor({ timeout: 20_000 });
    assert.equal(await page.getByRole("button", { name: /handbook\.md/ }).count(), 0);
    await page.reload();
    await page.getByRole("button", { name: /Knowledge off/ }).waitFor();
    await page.getByRole("button", { name: /Knowledge off/ }).click();
  });

  await check("memory: save, find, use in chat, edit, export, switch off, delete", async () => {
    await page.goto(`${baseUrl}/knowledge`);
    await page.getByRole("tab", { name: "Memory" }).click();
    await page.getByText("No memories yet").waitFor();
    await page.getByLabel("Add a memory").fill("My favorite color is teal.");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("list").getByText("My favorite color is teal.").waitFor();
    // An exact repeat, ignoring case, isn't stored twice.
    await page.getByLabel("Add a memory").fill("my favorite color is teal.");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByLabel("Add a memory").evaluate((el) => new Promise((resolve) => { const check = () => (el.value === "" ? resolve(true) : setTimeout(check, 25)); check(); }));
    assert.equal((await api("/api/memory")).body.memories.length, 1, "exact repeats aren't stored twice");

    await chatAsk("What is my favorite color? teal");
    await page.getByText(/I also remember: My favorite color is teal/).waitFor({ timeout: 20_000 });
    await page.getByText(/Used a memory/).waitFor();

    await page.goto(`${baseUrl}/knowledge`);
    await page.getByRole("tab", { name: "Memory" }).click();
    await page.getByRole("button", { name: "Edit memory" }).click();
    await page.getByLabel("Memory text").fill("My favorite color is orange.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("list").getByText("My favorite color is orange.").waitFor();
    const exported = await fetch(`${baseUrl}/api/memory/export`, { headers: sessionHeaders() });
    assert.match(exported.headers.get("content-disposition") ?? "", /omni-memories\.json/);
    assert.equal((await exported.json()).memories[0].content, "My favorite color is orange.");

    await page.getByRole("switch", { name: "Use memories in chat" }).click();
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false");
    await chatAsk("What is my favorite color? orange");
    await page.getByText("Hello from the mock model.").waitFor({ timeout: 20_000 });
    assert.equal(await page.getByText(/Used a memory/).count(), 0, "a switched-off memory isn't sent");

    await page.goto(`${baseUrl}/knowledge`);
    await page.getByRole("tab", { name: "Memory" }).click();
    await page.getByRole("switch", { name: "Use memories in chat" }).click();
    await page.getByRole("button", { name: "Delete memory" }).click();
    await page.getByText("No memories yet").waitFor();
  });

  await check("memory: 'Remember this' on a chat message saves it", async () => {
    await chatAsk("Say hello");
    await page.getByText("Hello from the mock model.").first().waitFor({ timeout: 20_000 });
    const message = page.locator("div.group").filter({ hasText: "Say hello" }).first();
    await message.hover();
    await message.getByRole("button", { name: "Remember this" }).click();
    await message.getByText("Saved to memory").waitFor();
    assert.ok((await api("/api/memory")).body.memories.some((m) => m.content === "Say hello"));
    await api("/api/memory?confirm=all", { method: "DELETE" });
  });

  await check("memory: deleting everything needs an explicit confirmation", async () => {
    const response = await api("/api/memory", { method: "DELETE" });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "confirmation_required");
  });

  await check("knowledge: notes can be indexed and then found", async () => {
    await api("/api/notes", { method: "POST", body: JSON.stringify({ title: "Garden plan", content: "Plant the tomatoes beside the basil in May." }) });
    await page.goto(`${baseUrl}/knowledge`);
    await page.getByRole("button", { name: "Index my notes" }).click();
    await page.getByText(/Notes synced: \d+ added/).waitFor();
    await page.getByRole("link", { name: "Garden plan" }).waitFor();
    await page.getByLabel("Search your knowledge").fill("where do I plant tomatoes");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("link", { name: "Garden plan" }).nth(1).waitFor();
  });

  await check("knowledge: deleting a document asks first, then removes it from search", async () => {
    await page.getByRole("button", { name: "Delete handbook.md" }).click();
    await page.getByRole("dialog", { name: "Delete this document?" }).waitFor();
    await page.getByRole("button", { name: "Cancel" }).click();
    assert.equal((await api("/api/knowledge")).body.documents.some((d) => d.name === "handbook.md"), true);
    await page.getByRole("button", { name: "Delete handbook.md" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("link", { name: "handbook.md", exact: true }).waitFor({ state: "detached" });
    const found = (await api("/api/knowledge/search", { method: "POST", body: JSON.stringify({ query: "vacation days employees" }) })).body;
    assert.ok(found.hits.every((hit) => hit.documentName !== "handbook.md"));
  });

  await check("knowledge: the API rejects oversized and malformed uploads", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.alloc(16 * 1024 * 1024, 97)]), "big.txt");
    const big = await fetch(`${baseUrl}/api/knowledge`, { method: "POST", headers: sessionHeaders(), body: form });
    assert.equal(big.status, 413);
    const none = await fetch(`${baseUrl}/api/knowledge`, { method: "POST", headers: sessionHeaders(), body: new FormData() });
    assert.equal(none.status, 400);
  });

  await check("mobile: the knowledge page fits a phone screen", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    for (const path of ["/knowledge"]) {
      await phone.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${path} overflows by ${overflow}px`);
    }
    await phone.getByRole("tab", { name: "Memory" }).click();
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `memory tab overflows by ${overflow}px`);
    await mobile.close();
  });

  await check("no unexpected browser errors", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} knowledge checks passed`);
process.exit(failed.length ? 1 : 0);
