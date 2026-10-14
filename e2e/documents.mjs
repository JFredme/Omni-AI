// Browser test for Documents: writing, AI drafting, downloads in every format (read back and checked), and exports from other pages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";
import { readZip } from "./zip.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
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
/** Clicks a download button and returns the saved file's name and bytes. */
async function downloadVia(button) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}
const text = (bytes) => bytes.toString("utf8");

try {
  await api("/api/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: VALID_KEY }) });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ defaultModelId: "mock/free-model", monthlyBudgetUsd: null }) });

  await check("documents: write one yourself, and download it as PDF, Word, Markdown and text", async () => {
    await page.goto(`${baseUrl}/documents`);
    await page.getByRole("heading", { name: "Documents", level: 1 }).waitFor();
    await page.getByRole("button", { name: "Write it myself" }).click();
    await page.getByLabel("Title").fill("Field notes");
    await page.getByLabel("Text (Markdown)").fill("# Observations\n\nThe **river** was high today.\n\n- Ducks\n- Herons\n\n| Bird | Count |\n| --- | --- |\n| Duck | 12 |\n");
    await page.getByLabel("Preview").getByText("The river was high today.").waitFor();

    const pdf = await downloadVia(page.getByRole("button", { name: "PDF" }));
    assert.equal(pdf.name, "Field-notes.pdf");
    assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
    const docx = await downloadVia(page.getByRole("button", { name: "Word (.docx)" }));
    assert.equal(docx.name, "Field-notes.docx");
    const xml = text(readZip(docx.bytes).get("word/document.xml"));
    for (const expected of ["Field notes", "Observations", "river", "Herons", "Duck"]) assert.ok(xml.includes(expected), expected);
    const md = await downloadVia(page.getByRole("button", { name: "Markdown" }));
    assert.match(text(md.bytes), /# Field notes/);
    assert.match(text(md.bytes), /\| Bird \| Count \|/);
    const txt = await downloadVia(page.getByRole("button", { name: "Plain text" }));
    assert.match(text(txt.bytes), /• Ducks/);
  });

  await check("documents: PDF export says when characters from other scripts couldn't be kept", async () => {
    await page.getByLabel("Text (Markdown)").fill("Mixed text: café and 日本語.");
    await downloadVia(page.getByRole("button", { name: "PDF" }));
    await page.getByText(/3 characters outside Western European alphabets/).waitFor();
  });

  await check("documents: the assistant drafts a document you can edit before downloading, or keep as a note", async () => {
    await page.goto(`${baseUrl}/documents`);
    await page.getByLabel("What should it be?").fill("A short launch memo for the team");
    await page.getByRole("button", { name: "Draft it" }).click();
    await page.getByLabel("Draft", { exact: true }).getByLabel("Title").waitFor({ timeout: 30_000 });
    assert.equal(await page.getByLabel("Title").inputValue(), "Launch memo");
    await page.getByLabel("Preview").getByText("We will launch on Friday after a final review.").waitFor();
    await page.getByLabel("Text (Markdown)").fill((await page.getByLabel("Text (Markdown)").inputValue()) + "\n\nAdded by hand.\n");
    const docx = await downloadVia(page.getByRole("button", { name: "Word (.docx)" }));
    const xml = text(readZip(docx.bytes).get("word/document.xml"));
    assert.ok(xml.includes("Added by hand."));
    assert.ok(xml.includes("Prepare the announcement"));
    await page.getByRole("button", { name: "Save as note" }).click();
    await page.getByText("Saved as a note.").waitFor();
    assert.ok((await api("/api/notes")).body.notes.some((n) => n.title === "Launch memo"));
    assert.ok(!(await api("/api/knowledge")).body.documents.some((d) => d.name === "Launch memo"), "drafting doesn't save anything by itself");
  });

  await check("documents: a slide deck is drafted, previewed as slides, and downloaded as PowerPoint, PDF, and Markdown", async () => {
    await page.goto(`${baseUrl}/documents`);
    await page.getByRole("tab", { name: "Slides" }).click();
    await page.getByLabel("What should it be?").fill("A pitch for a neighborhood tool library");
    await page.getByRole("button", { name: "Draft it" }).click();
    const slides = page.getByLabel("Slides", { exact: true });
    await slides.getByText("The problem").waitFor({ timeout: 30_000 });
    await slides.getByText("Speaker notes: Open with a story.").waitFor();
    const pptx = await downloadVia(page.getByRole("button", { name: "PowerPoint (.pptx)" }));
    assert.equal(pptx.name, "Tool-library-pitch.pptx");
    const parts = readZip(pptx.bytes);
    const all = [...parts.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => text(parts.get(n))).join("");
    for (const expected of ["Tool library pitch", "The problem", "Tools sit unused", "Share tools across the street"]) assert.ok(all.includes(expected), expected);
    const pdf = await downloadVia(page.getByRole("button", { name: "PDF" }));
    assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
    const md = await downloadVia(page.getByRole("button", { name: "Markdown" }));
    assert.match(text(md.bytes), /## The idea/);
  });

  await check("documents: a spreadsheet is drafted and downloaded as Excel and CSV, with formulas defused", async () => {
    await page.goto(`${baseUrl}/documents`);
    await page.getByRole("tab", { name: "Spreadsheet" }).click();
    await page.getByLabel("What should it be?").fill("A simple household budget");
    await page.getByRole("button", { name: "Draft it" }).click();
    const sheet = page.getByLabel("Spreadsheet", { exact: true });
    await sheet.getByRole("cell", { name: "Rent" }).waitFor({ timeout: 30_000 });
    const xlsx = await downloadVia(page.getByRole("button", { name: "Excel (.xlsx)" }));
    assert.equal(xlsx.name, "Household-budget.xlsx");
    const sheetXml = readZip(xlsx.bytes);
    const sheets = [...sheetXml.keys()].filter((n) => n.startsWith("xl/worksheets/sheet"));
    assert.ok(sheets.length >= 1);
    const sharedOrInline = text(sheetXml.get("xl/sharedStrings.xml") ?? Buffer.from("")) + text(sheetXml.get(sheets[0]));
    assert.ok(sharedOrInline.includes("Rent") && sharedOrInline.includes("1200"));
    const csv = await downloadVia(page.getByRole("button", { name: "CSV" }));
    const csvText = text(csv.bytes);
    assert.ok(csvText.startsWith("﻿Category,Planned\r\n"));
    assert.ok(csvText.includes("Rent,1200"));
    assert.ok(csvText.includes("'=SUM(B2:B2),5"), "a formula-looking cell is kept as text");
  });

  await check("documents: notes, projects, tasks and research can be exported from their own pages", async () => {
    const note = (await api("/api/notes", { method: "POST", body: JSON.stringify({ title: "Trip plan", content: "# Day one\n\nArrive and **rest**.\n" }) })).body.note;
    await page.goto(`${baseUrl}/notes/${note.id}`);
    await page.getByLabel("Export", { exact: true }).click();
    const fromPage = await downloadVia(page.getByRole("link", { name: "PDF" }));
    assert.equal(fromPage.name, "Trip-plan.pdf");
    assert.equal(fromPage.bytes.subarray(0, 5).toString(), "%PDF-");

    const project = (await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "Website relaunch" }) })).body.project;
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Write copy", projectId: project.id }) });
    await page.goto(`${baseUrl}/projects/${project.id}`);
    await page.getByLabel("Report", { exact: true }).click();
    const report = await downloadVia(page.getByRole("link", { name: "Word (.docx)" }));
    assert.equal(report.name, "Website-relaunch.docx");
    assert.ok(text(readZip(report.bytes).get("word/document.xml")).includes("Write copy"));

    await page.goto(`${baseUrl}/tasks`);
    await page.getByLabel("Export", { exact: true }).click();
    const tasks = await downloadVia(page.getByRole("link", { name: "CSV" }));
    assert.equal(tasks.name, "Tasks.csv");
    assert.ok(text(tasks.bytes).includes("Write copy"));

    for (const url of [`/api/notes/${note.id}/export?format=docx`, `/api/notes/${note.id}/export?format=md`, `/api/notes/${note.id}/export?format=txt`, "/api/tasks/export?format=xlsx", `/api/projects/${project.id}/export?format=pdf`]) {
      const response = await retryingFetch(`${baseUrl}${url}`, { headers: sessionHeaders() });
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="[A-Za-z0-9._-]+"$/);
    }
  });

  await check("documents: bad requests are refused, and every route needs a sign-in", async () => {
    assert.equal((await api("/api/notes/missing/export?format=pdf")).status, 404);
    assert.equal((await api("/api/notes/anything/export?format=exe")).status, 400);
    assert.equal((await api("/api/tasks/export?format=pdf")).status, 400);
    assert.equal((await api("/api/documents/export", { method: "POST", body: JSON.stringify({ kind: "document", format: "pptx", document: { title: "x", blocks: [] } }) })).status, 400);
    assert.equal((await api("/api/documents/export", { method: "POST", body: JSON.stringify({ kind: "document", format: "pdf", document: { title: "x", blocks: [{ type: "script", text: "<script>" }] } }) })).status, 400);
    assert.equal((await api("/api/documents/generate", { method: "POST", body: JSON.stringify({ kind: "document", prompt: "hi" }) })).body.error.code, "prompt_too_short");
    for (const [method, path] of [["POST", "/api/documents/export"], ["POST", "/api/documents/generate"], ["GET", "/api/tasks/export"], ["GET", "/api/notes/x/export"]]) {
      assert.equal((await fetch(`${baseUrl}${path}`, { method, body: method === "POST" ? "{}" : undefined })).status, 401, path);
    }
  });

  await check("mobile: the documents page fits a phone screen", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    await phone.goto(`${baseUrl}/documents`, { waitUntil: "networkidle" });
    await phone.getByRole("button", { name: "Write it myself" }).click();
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
console.log(`\n${results.length - failed.length}/${results.length} document checks passed`);
process.exit(failed.length ? 1 : 0);
