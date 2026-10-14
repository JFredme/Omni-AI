// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import {
  createConversation,
  deleteConversation,
  getConversation,
  prepareRegenerate,
  prepareSend,
  runTurn,
  updateConversation,
} from "@/lib/chat/service";
import type { TurnEvent } from "@/lib/chat/types";
import { clearCatalogCache } from "@/lib/openrouter/catalog";
import { getUsageSummary } from "@/lib/usage";
import { getSettingsView, resolveApiKey, saveApiKey, updateSettings } from "@/lib/settings";
import { GET as getSettingsRoute } from "@/app/api/settings/route";

const API_KEY = "sk-or-v1-integration-test-key-1234";
const MODEL = "acme/chat-model";

const fetchMock = vi.fn<typeof fetch>();

type Handler = (init: RequestInit) => Response | Promise<Response>;
let completion: Handler = () => new Response("unused", { status: 500 });

function dataLine(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Streams the given chunks. With `hold`, the stream stays open (as a slow model would) until the client aborts. */
function streamOf(chunks: string[], { hold = false }: { hold?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!hold) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function completionChunks(text: string, usage: Record<string, unknown> | null) {
  return [
    dataLine({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }),
    dataLine({ choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }], ...(usage ? { usage } : {}) }),
    "data: [DONE]\n\n",
  ];
}

function route(url: string, init: RequestInit): Promise<Response> | Response {
  const path = new URL(url).pathname;
  if (path.endsWith("/models")) {
    return Response.json({
      data: [
        {
          id: MODEL,
          name: "Chat Model",
          pricing: { prompt: "0.000001", completion: "0.000002" },
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          supported_parameters: ["tools"],
        },
      ],
    });
  }
  if (path.endsWith("/chat/completions")) {
    return completion(init);
  }
  return new Response("not found", { status: 404 });
}

async function drain(plan: Parameters<typeof runTurn>[0], signal = new AbortController().signal): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runTurn(plan, signal)) events.push(event);
  return events;
}

function sentBody(callIndex = fetchMock.mock.calls.length - 1) {
  return JSON.parse(String(fetchMock.mock.calls[callIndex][1]?.body)) as {
    model: string;
    messages: { role: string; content: string }[];
  };
}

describe("chat service (database + mocked OpenRouter)", () => {
  beforeAll(() => {
    const dbName = new URL(process.env.DATABASE_URL ?? "").pathname;
    if (!/_test$/.test(dbName)) throw new Error(`Integration tests only run against a *_test database, got ${dbName}`);
  });

  beforeEach(async () => {
    await prisma.usageRecord.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.appSettings.deleteMany();
    clearCatalogCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => route(String(input), init ?? {}));
    vi.stubGlobal("fetch", fetchMock);
    completion = () => streamOf(completionChunks("Hi! How can I help?", { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18, cost: 0.00012 }));
    await saveApiKey(API_KEY);
    await updateSettings({ defaultModelId: null, monthlyBudgetUsd: null, favoriteModelIds: [] });
  });

  it("streams a reply, persists both messages, names the chat, and records OpenRouter cost", async () => {
    const conversation = await createConversation({ modelId: MODEL });
    const plan = await prepareSend(conversation.id, { content: "Hello there\nsecond line" });
    const events = await drain(plan);

    expect(events.map((event) => event.type)).toEqual(["start", "delta", "done"]);
    expect(events[1]).toEqual({ type: "delta", text: "Hi! How can I help?" });

    const detail = await getConversation(conversation.id);
    expect(detail.title).toBe("Hello there");
    expect(detail.messages.map((message) => [message.role, message.status])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    expect(detail.messages[1]).toMatchObject({
      content: "Hi! How can I help?",
      modelId: MODEL,
      usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18, costUsd: 0.00012, costSource: "openrouter" },
    });
    expect(detail.usage).toEqual({ requests: 1, totalTokens: 18, costUsd: 0.00012, unknownCostRequests: 0 });

    expect(sentBody()).toMatchObject({
      model: MODEL,
      messages: [{ role: "user", content: "Hello there\nsecond line" }],
    });
  });

  it("estimates cost from catalog prices when OpenRouter reports no cost", async () => {
    completion = () =>
      streamOf(completionChunks("Estimated", { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }));
    const conversation = await createConversation({ modelId: MODEL });
    await drain(await prepareSend(conversation.id, { content: "Price this" }));

    const detail = await getConversation(conversation.id);
    expect(detail.messages[1].usage).toMatchObject({ costSource: "estimated" });
    expect(detail.messages[1].usage?.costUsd).toBeCloseTo(1000 * 0.000001 + 500 * 0.000002, 12);
  });

  it("sends the system prompt first and includes earlier turns", async () => {
    const conversation = await createConversation({ modelId: MODEL });
    await updateConversation(conversation.id, { systemPrompt: "  Answer in one sentence.  " });
    await drain(await prepareSend(conversation.id, { content: "First" }));
    await drain(await prepareSend(conversation.id, { content: "Second" }));

    expect(sentBody().messages).toEqual([
      { role: "system", content: "Answer in one sentence." },
      { role: "user", content: "First" },
      { role: "assistant", content: "Hi! How can I help?" },
      { role: "user", content: "Second" },
    ]);
  });

  it("keeps partial text and marks the reply stopped when the user aborts", async () => {
    completion = () =>
      streamOf([dataLine({ choices: [{ index: 0, delta: { content: "Once upon" }, finish_reason: null }] })], { hold: true });
    const conversation = await createConversation({ modelId: MODEL });
    const plan = await prepareSend(conversation.id, { content: "Tell me a story" });
    const abort = new AbortController();
    const events: TurnEvent[] = [];
    for await (const event of runTurn(plan, abort.signal)) {
      events.push(event);
      if (event.type === "delta") abort.abort();
    }

    expect(events.at(-1)?.type).toBe("stopped");
    const detail = await getConversation(conversation.id);
    expect(detail.messages[1]).toMatchObject({ status: "stopped", content: "Once upon", error: null });
    expect(detail.messages[1].usage).toMatchObject({ totalTokens: null, costSource: "unknown" });
  });

  it("stores the failure when OpenRouter rejects the key", async () => {
    completion = () => Response.json({ error: { code: 401, message: "No auth credentials found" } }, { status: 401 });
    const conversation = await createConversation({ modelId: MODEL });
    const events = await drain(await prepareSend(conversation.id, { content: "Hello" }));

    expect(events.at(-1)).toMatchObject({ type: "error", code: "invalid_key" });
    const detail = await getConversation(conversation.id);
    expect(detail.messages[1]).toMatchObject({ status: "error" });
    expect(detail.messages[1].error).toMatch(/rejected the API key/);
    expect(detail.messages[1].usage).toMatchObject({ totalTokens: null, costSource: "unknown" });
  });

  it("keeps partial text when the stream fails mid-reply", async () => {
    completion = () =>
      streamOf([
        dataLine({ choices: [{ index: 0, delta: { content: "Partial" }, finish_reason: null }] }),
        dataLine({
          error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } },
          choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
        }),
      ]);
    const conversation = await createConversation({ modelId: MODEL });
    const events = await drain(await prepareSend(conversation.id, { content: "Go" }));

    expect(events.at(-1)).toMatchObject({ type: "error", code: "rate_limited" });
    const detail = await getConversation(conversation.id);
    expect(detail.messages[1]).toMatchObject({ status: "error", content: "Partial" });
  });

  it("blocks new messages once the monthly limit is reached, without saving anything", async () => {
    await prisma.usageRecord.create({
      data: { modelId: MODEL, status: "complete", costUsd: 5, costSource: "openrouter" },
    });
    await updateSettings({ monthlyBudgetUsd: 1 });
    const conversation = await createConversation({ modelId: MODEL });

    const error = await prepareSend(conversation.id, { content: "Too expensive" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 402, code: "budget_exceeded" });
    expect((await getConversation(conversation.id)).messages).toHaveLength(0);
  });

  it("requires a model before sending", async () => {
    const conversation = await createConversation({});
    await expect(prepareSend(conversation.id, { content: "Hi" })).rejects.toMatchObject({ code: "model_required" });
  });

  it("rejects a second send while a reply is still streaming", async () => {
    const conversation = await createConversation({ modelId: MODEL });
    await prisma.message.create({
      data: { conversationId: conversation.id, role: "assistant", content: "", status: "streaming", modelId: MODEL },
    });
    await expect(prepareSend(conversation.id, { content: "Again" })).rejects.toMatchObject({ status: 409 });
  });

  it("marks abandoned streaming replies as errors when the conversation is opened", async () => {
    const conversation = await createConversation({ modelId: MODEL });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: "half",
        status: "streaming",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    const detail = await getConversation(conversation.id);
    expect(detail.messages[0]).toMatchObject({ status: "error" });
    expect(detail.messages[0].error).toMatch(/interrupted/);
  });

  it("regenerates the last reply in place", async () => {
    const conversation = await createConversation({ modelId: MODEL });
    await drain(await prepareSend(conversation.id, { content: "Hello" }));

    completion = () => streamOf(completionChunks("Second answer", null));
    const events = await drain(await prepareRegenerate(conversation.id, {}));

    expect(events.at(-1)?.type).toBe("done");
    expect(sentBody().messages).toEqual([{ role: "user", content: "Hello" }]);
    const detail = await getConversation(conversation.id);
    expect(detail.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Hello"],
      ["assistant", "Second answer"],
    ]);
  });

  it("keeps usage history after a conversation is deleted", async () => {
    const conversation = await createConversation({ modelId: MODEL });
    await drain(await prepareSend(conversation.id, { content: "Remember me" }));
    await deleteConversation(conversation.id);

    expect(await prisma.conversation.count()).toBe(0);
    const summary = await getUsageSummary();
    expect(summary.totals.requests).toBe(1);
    expect(summary.totals.costUsd).toBeCloseTo(0.00012, 10);
    expect(summary.byModel[0]).toMatchObject({ modelId: MODEL, requests: 1 });
  });

  it("encrypts the saved key and never returns it to the client", async () => {
    const row = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.encryptedApiKey).toBeTruthy();
    expect(row.encryptedApiKey).not.toContain("integration-test-key");
    expect(row.apiKeyLast4).toBe("1234");

    expect((await resolveApiKey())?.key).toBe(API_KEY);
    const view = await getSettingsView();
    expect(JSON.stringify(view)).not.toContain("integration-test-key");
    expect(view.apiKey).toMatchObject({ configured: true, source: "settings", last4: "1234" });

    const response = await getSettingsRoute();
    expect(await response.text()).not.toContain("integration-test-key");
  });

  it("returns 404 for an unknown conversation", async () => {
    await expect(getConversation("does-not-exist")).rejects.toMatchObject({ status: 404 });
  });
});
