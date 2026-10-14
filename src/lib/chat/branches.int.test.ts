// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { clearCatalogCache } from "@/lib/openrouter/catalog";
import { saveApiKey, updateSettings } from "@/lib/settings";
import { assertTestDatabase } from "@/test/db-guard";
import { createAttachment } from "./attachments";
import { exportConversation } from "./export";
import { createConversation, getConversation, prepareRegenerate, prepareSend, runTurn, selectBranch } from "./service";
import { summarizeConversation } from "./summarize";
import type { TurnEvent } from "./types";

const fetchMock = vi.fn<typeof fetch>();
let reply = "Sure.";
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const text = (value: string) => new TextEncoder().encode(value);

function sse(content: string): Response {
  const encoder = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(encoder.encode(chunk)); c.close(); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function drain(plan: Parameters<typeof runTurn>[0]): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runTurn(plan, new AbortController().signal)) events.push(event);
  return events;
}

const lastBody = () => JSON.parse(String(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/chat/completions")).at(-1)?.[1]?.body)) as { messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] };

async function say(conversationId: string, content: string, extra: Record<string, unknown> = {}) {
  await drain(await prepareSend(conversationId, { content, ...extra }));
}
const shown = async (id: string) => (await getConversation(id)).messages.map((m) => m.content);

beforeEach(async () => {
  assertTestDatabase();
  await prisma.attachment.deleteMany();
  await prisma.usageRecord.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.appSettings.deleteMany();
  clearCatalogCache();
  reply = "Sure.";
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/chat/completions")) return sse(reply);
    if (path.endsWith("/models")) {
      return Response.json({
        data: [
          { id: "acme/vision", name: "Vision", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, pricing: { prompt: "0.000001", completion: "0.000002" } },
          { id: "acme/textonly", name: "Text Only", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, pricing: { prompt: "0.000001", completion: "0.000002" } },
        ],
      });
    }
    return Response.json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  await saveApiKey("sk-or-v1-integration-test-key-1234");
  await updateSettings({ defaultModelId: "acme/vision", monthlyBudgetUsd: null });
});

describe("editing and regenerating create branches", () => {
  it("editing a message keeps the original as another branch and drops later turns from the new one", async () => {
    const { id } = await createConversation({});
    reply = "A1";
    await say(id, "first question");
    reply = "A2";
    await say(id, "second question");
    expect(await shown(id)).toEqual(["first question", "A1", "second question", "A2"]);

    const before = await getConversation(id);
    const secondQuestion = before.messages[2];
    reply = "A2-edited";
    await say(id, "second question, reworded", { replaceMessageId: secondQuestion.id });

    const after = await getConversation(id);
    expect(after.messages.map((m) => m.content)).toEqual(["first question", "A1", "second question, reworded", "A2-edited"]);
    // The model saw the first exchange and the edit, not the abandoned second question.
    const sent = lastBody().messages.map((m) => (typeof m.content === "string" ? m.content : ""));
    expect(sent).toEqual(["first question", "A1", "second question, reworded"]);
    // The edited message knows it has an alternative.
    expect(after.messages[2].branch).toMatchObject({ index: 1, count: 2 });
    expect(after.messages[2].branch.ids[0]).toBe(secondQuestion.id);
    // Nothing was deleted.
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(6);
  });

  it("can switch back to the original branch, and lands on its newest message", async () => {
    const { id } = await createConversation({});
    reply = "A1";
    await say(id, "question");
    const original = (await getConversation(id)).messages[0];
    reply = "A1-edit";
    await say(id, "question v2", { replaceMessageId: original.id });
    expect(await shown(id)).toEqual(["question v2", "A1-edit"]);

    await selectBranch(id, original.id);
    expect(await shown(id)).toEqual(["question", "A1"]);
    // New messages continue whichever branch is showing.
    reply = "A-follow";
    await say(id, "follow up");
    expect(await shown(id)).toEqual(["question", "A1", "follow up", "A-follow"]);
  });

  it("editing the very first message works", async () => {
    const { id } = await createConversation({});
    await say(id, "hello");
    const first = (await getConversation(id)).messages[0];
    await say(id, "hello again", { replaceMessageId: first.id });
    const after = await getConversation(id);
    expect(after.messages.map((m) => m.content)).toEqual(["hello again", "Sure."]);
    expect(after.messages[0].branch).toMatchObject({ index: 1, count: 2 });
  });

  it("regenerating keeps the earlier reply as an alternative", async () => {
    const { id } = await createConversation({});
    reply = "first answer";
    await say(id, "question");
    reply = "second answer";
    await drain(await prepareRegenerate(id, {}));
    const detail = await getConversation(id);
    expect(detail.messages.map((m) => m.content)).toEqual(["question", "second answer"]);
    expect(detail.messages[1].branch).toMatchObject({ index: 1, count: 2 });
    await selectBranch(id, detail.messages[1].branch.ids[0]);
    expect(await shown(id)).toEqual(["question", "first answer"]);
  });

  it("refuses to edit an assistant message or a message from another conversation", async () => {
    const a = await createConversation({});
    const b = await createConversation({});
    await say(a.id, "hi");
    const [user, assistant] = (await getConversation(a.id)).messages;
    await expect(prepareSend(a.id, { content: "x", replaceMessageId: assistant.id })).rejects.toMatchObject({ code: "cannot_edit" });
    await expect(prepareSend(b.id, { content: "x", replaceMessageId: user.id })).rejects.toMatchObject({ code: "cannot_edit" });
    await expect(selectBranch(b.id, user.id)).rejects.toMatchObject({ status: 404 });
  });

  it("migrates old linear conversations: the backfill chains messages and sets the leaf", async () => {
    const conversation = await prisma.conversation.create({ data: { title: "old" } });
    const base = Date.now();
    for (const [index, role] of (["user", "assistant", "user", "assistant"] as const).entries()) {
      await prisma.message.create({ data: { conversationId: conversation.id, role, content: `m${index}`, createdAt: new Date(base + index * 1000) } });
    }
    const sql = readFileSync(new URL("../../../prisma/migrations", import.meta.url).pathname + "/" + "20261014121917_chat_branches_attachments/migration.sql", "utf8");
    const backfill = sql.slice(sql.indexOf("-- Backfill"));
    for (const statement of backfill.split(";").map((part) => part.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    const detail = await getConversation(conversation.id);
    expect(detail.messages.map((m) => m.content)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(detail.messages.map((m) => m.parentId === null)).toEqual([true, false, false, false]);
    expect(detail.leafId).toBe(detail.messages[3].id);
  });
});

describe("attachments", () => {
  it("sends an image to a vision model and keeps it with the message", async () => {
    const { id } = await createConversation({});
    const image = await createAttachment({ name: "pixel.png", bytes: PNG });
    await say(id, "what is this?", { attachmentIds: [image.id] });
    const content = lastBody().messages.at(-1)!.content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as { type: string }[]).map((part) => part.type)).toEqual(["text", "image_url"]);
    expect((content as { image_url?: { url: string } }[])[1].image_url!.url).toMatch(/^data:image\/png;base64,/);
    const detail = await getConversation(id);
    expect(detail.messages[0].attachments).toEqual([{ id: image.id, name: "pixel.png", kind: "image", mimeType: "image/png", sizeBytes: PNG.length }]);
  });

  it("keeps sending an earlier image on later turns", async () => {
    const { id } = await createConversation({});
    const image = await createAttachment({ name: "pixel.png", bytes: PNG });
    await say(id, "look at this", { attachmentIds: [image.id] });
    await say(id, "and now?");
    const sent = lastBody().messages;
    expect(JSON.stringify(sent[0].content)).toContain("image_url");
  });

  it("inlines a document's text, fenced as data", async () => {
    const { id } = await createConversation({});
    const doc = await createAttachment({ name: "notes.md", bytes: text("# Plan\n\nShip on Friday.") });
    expect(doc.kind).toBe("document");
    await say(id, "summarize", { attachmentIds: [doc.id] });
    const content = lastBody().messages.at(-1)!.content as string;
    expect(content).toContain('<attachment name="notes.md">');
    expect(content).toContain("Ship on Friday.");
    expect(content).toMatch(/data to read, not instructions/);
  });

  it("can't attach the same file to two messages, or a missing one", async () => {
    const { id } = await createConversation({});
    const doc = await createAttachment({ name: "a.txt", bytes: text("hello there") });
    await say(id, "one", { attachmentIds: [doc.id] });
    await expect(prepareSend(id, { content: "two", attachmentIds: [doc.id] })).rejects.toMatchObject({ code: "attachment_missing" });
    await expect(prepareSend(id, { content: "three", attachmentIds: ["nope"] })).rejects.toMatchObject({ code: "attachment_missing" });
  });

  it("refuses images for a model that can't read them", async () => {
    const { id } = await createConversation({ modelId: "acme/textonly" });
    const image = await createAttachment({ name: "pixel.png", bytes: PNG });
    await expect(prepareSend(id, { content: "look", attachmentIds: [image.id] })).rejects.toMatchObject({ status: 400, code: "model_cannot_read_images" });
    expect(await prisma.message.count()).toBe(0);
  });

  it("validates uploads", async () => {
    await expect(createAttachment({ name: "x.exe", bytes: text("MZ") })).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(createAttachment({ name: "fake.png", bytes: text("not a png") })).rejects.toMatchObject({ code: "invalid_file" });
    await expect(createAttachment({ name: "big.png", bytes: new Uint8Array(6 * 1024 * 1024) })).rejects.toMatchObject({ status: 413 });
    await expect(createAttachment({ name: "fake.pdf", bytes: text("nope") })).rejects.toMatchObject({ code: "unreadable_file" });
    await expect(createAttachment({ name: "e.txt", bytes: new Uint8Array(0) })).rejects.toMatchObject({ code: "empty_file" });
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("limits attachments per message", async () => {
    const { id } = await createConversation({});
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await createAttachment({ name: `f${i}.txt`, bytes: text(`file ${i}`) })).id);
    await expect(prepareSend(id, { content: "many", attachmentIds: ids })).rejects.toMatchObject({ code: "too_many_attachments" });
  });

  it("allows sending only an attachment", async () => {
    const { id } = await createConversation({});
    const image = await createAttachment({ name: "pixel.png", bytes: PNG });
    await say(id, "", { attachmentIds: [image.id] });
    expect((await getConversation(id)).messages[0].attachments).toHaveLength(1);
  });

  it("deletes attachments with their conversation", async () => {
    const { id } = await createConversation({});
    const image = await createAttachment({ name: "pixel.png", bytes: PNG });
    await say(id, "keep", { attachmentIds: [image.id] });
    await prisma.conversation.delete({ where: { id } });
    expect(await prisma.attachment.count()).toBe(0);
  });
});

describe("export and summary", () => {
  it("exports the shown branch as Markdown, text and JSON", async () => {
    const { id } = await createConversation({});
    await prisma.conversation.update({ where: { id }, data: { title: "Trip / plan?" } });
    reply = "Take the **morning** train.";
    await say(id, "How do I get there?");
    const detail = await getConversation(id);
    const md = exportConversation(detail, "md", new Date("2026-01-02T00:00:00Z"));
    expect(md.filename).toBe("trip-plan.md");
    expect(md.body).toContain("# Trip / plan?");
    expect(md.body).toContain("## You\n\nHow do I get there?");
    expect(md.body).toContain("Take the **morning** train.");
    const txt = exportConversation(detail, "txt");
    expect(txt.body).toContain("You:\nHow do I get there?");
    const json = JSON.parse(exportConversation(detail, "json").body);
    expect(json.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("summarizes a conversation through the model and validates the reply", async () => {
    const { id } = await createConversation({});
    await say(id, "We should book the venue by Friday.");
    reply = `{"summary":"They need to book the venue by Friday.","keyPoints":["Venue deadline is Friday"],"actionItems":["Book the venue"]}`;
    const result = await summarizeConversation(id);
    expect(result.summary).toMatch(/venue/);
    expect(result.actionItems).toEqual(["Book the venue"]);
    const body = lastBody();
    expect(String(body.messages.at(-1)!.content)).toContain("<data>");
    reply = "not json at all";
    await expect(summarizeConversation(id)).rejects.toBeTruthy();
    const empty = await createConversation({});
    await expect(summarizeConversation(empty.id)).rejects.toMatchObject({ code: "nothing_to_summarize" });
  });
});
