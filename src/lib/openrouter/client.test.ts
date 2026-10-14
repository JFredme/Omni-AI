// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchKeyInfo, fetchModelCatalog, streamChatCompletion, type StreamEvent } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";

const BASE = "https://openrouter.test/api/v1";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function dataLine(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function collect(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("OpenRouter client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.OPENROUTER_BASE_URL = BASE;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_BASE_URL;
  });

  describe("fetchModelCatalog", () => {
    it("requests text models, sends the key when given, and drops malformed entries", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          data: [
            { id: "a/one", pricing: { prompt: "0", completion: "0" } },
            { name: "missing id" },
          ],
        }),
      );

      const models = await fetchModelCatalog({ apiKey: "sk-or-v1-test" });

      expect(models.map((model) => model.id)).toEqual(["a/one"]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`${BASE}/models?output_modalities=text`);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-v1-test");
    });

    it("maps a 401 to an invalid-key error", async () => {
      fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 401, message: "No auth" } }, { status: 401 }));
      await expect(fetchModelCatalog({ apiKey: "bad" })).rejects.toMatchObject({ kind: "invalid_key", status: 401 });
    });

    it("reports network failures", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      await expect(fetchModelCatalog()).rejects.toMatchObject({ kind: "network" });
    });
  });

  describe("fetchKeyInfo", () => {
    it("maps the key response", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          data: {
            label: "sk-or-v1-...abcd",
            is_free_tier: false,
            is_management_key: false,
            limit: 10,
            limit_remaining: 7.5,
            usage: 2.5,
            usage_daily: 0.5,
            usage_monthly: 2.5,
            expires_at: null,
          },
        }),
      );
      await expect(fetchKeyInfo("sk-or-v1-x")).resolves.toEqual({
        label: "sk-or-v1-...abcd",
        isFreeTier: false,
        isManagementKey: false,
        limit: 10,
        limitRemaining: 7.5,
        usage: 2.5,
        usageDaily: 0.5,
        usageMonthly: 2.5,
        expiresAt: null,
      });
    });
  });

  describe("streamChatCompletion", () => {
    const body = { model: "a/one", messages: [{ role: "user" as const, content: "hi" }] };

    it("yields deltas, usage, and finish events, and requests streaming", async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          dataLine({ id: "g1", choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] }),
          ": OPENROUTER PROCESSING\n\n",
          dataLine({ id: "g1", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }] }),
          dataLine({
            id: "g1",
            choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.00004 },
          }),
          "data: [DONE]\n\n",
        ]),
      );

      const events = await collect(
        streamChatCompletion({ apiKey: "sk-or-v1-test", body, signal: new AbortController().signal }),
      );

      expect(events).toEqual([
        { type: "delta", text: "Hel" },
        { type: "delta", text: "lo" },
        { type: "usage", usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, cost: 0.00004 } },
        { type: "finish", reason: "stop" },
      ]);
      const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(sent).toMatchObject({ model: "a/one", stream: true });
    });

    it("throws a typed error for mid-stream error events", async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          dataLine({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] }),
          dataLine({
            error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } },
            choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
          }),
        ]),
      );

      const events: StreamEvent[] = [];
      const run = async () => {
        for await (const event of streamChatCompletion({ apiKey: "k", body, signal: new AbortController().signal })) {
          events.push(event);
        }
      };
      await expect(run()).rejects.toMatchObject({ kind: "rate_limited", errorType: "rate_limit_exceeded" });
      expect(events).toEqual([{ type: "delta", text: "partial" }]);
    });

    it("maps a non-200 response before streaming starts", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), {
          status: 402,
          headers: { "Content-Type": "application/json", "Retry-After": "30" },
        }),
      );
      const error = await collect(
        streamChatCompletion({ apiKey: "k", body, signal: new AbortController().signal }),
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OpenRouterError);
      expect(error).toMatchObject({ kind: "payment_required", status: 402, message: "Insufficient credits" });
    });

    it("fails when the stream ends before the model finishes", async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([dataLine({ choices: [{ index: 0, delta: { content: "cut" }, finish_reason: null }] })]),
      );
      await expect(
        collect(streamChatCompletion({ apiKey: "k", body, signal: new AbortController().signal })),
      ).rejects.toMatchObject({ kind: "provider_error" });
    });

    it("rethrows the caller's abort rather than wrapping it", async () => {
      const controller = new AbortController();
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const pending = collect(streamChatCompletion({ apiKey: "k", body, signal: controller.signal }));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });

    it("times out when the stream goes silent", async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start() {
                // Never sends data.
              },
              cancel() {},
            }),
            { status: 200 },
          ),
        ),
      );
      await expect(
        collect(
          streamChatCompletion({
            apiKey: "k",
            body,
            signal: new AbortController().signal,
            idleTimeoutMs: 30,
          }),
        ),
      ).rejects.toMatchObject({ kind: "timeout" });
    });
  });
});
