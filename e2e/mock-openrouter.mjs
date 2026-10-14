// Minimal stand-in for the OpenRouter HTTP API, used by the end-to-end test.
// It mirrors the response shapes documented at openrouter.ai/docs so the app exercises real parsing.
//
// Keys: "sk-or-v1-e2e-valid-key-123456" is accepted; any other key gets a 401.
// Prompt triggers (case-insensitive, in the last user message):
//   "slow"   streams many small chunks slowly, so a test can press Stop
//   "break"  streams partial text, then a mid-stream rate-limit error event
//   otherwise a short reply with usage (20 in / 8 out, cost 0.000123)
import { createServer } from "node:http";

export const VALID_KEY = "sk-or-v1-e2e-valid-key-123456";
const port = Number(process.env.MOCK_PORT ?? 4010);

const models = [
  {
    id: "mock/free-model",
    name: "Mock Free",
    description: "Free test model",
    created: 1767225600,
    context_length: 32000,
    pricing: { prompt: "0", completion: "0", request: "0", image: "0" },
    architecture: { input_modalities: ["text"], output_modalities: ["text"], modality: "text->text" },
    supported_parameters: ["temperature", "max_tokens"],
    top_provider: { context_length: 32000, max_completion_tokens: 2048, is_moderated: false },
  },
  {
    id: "mock/pro-model",
    name: "Mock Pro",
    description: "Paid test model with tools and images",
    created: 1767312000,
    context_length: 200000,
    pricing: { prompt: "0.000003", completion: "0.000015", request: "0", image: "0" },
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"], modality: "text+image->text" },
    supported_parameters: ["tools", "response_format", "temperature"],
    top_provider: { context_length: 200000, max_completion_tokens: 8192, is_moderated: false },
  },
];

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  return request.headers.authorization === `Bearer ${VALID_KEY}`;
}

function chunk(content, extra = {}) {
  return `data: ${JSON.stringify({
    id: "gen-mock",
    object: "chat.completion.chunk",
    model: "mock/free-model",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
    ...extra,
  })}\n\n`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function streamCompletion(response, prompt) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  response.write(": OPENROUTER PROCESSING\n\n");

  if (prompt.includes("slow")) {
    for (let index = 0; index < 60; index += 1) {
      if (response.destroyed) return;
      response.write(chunk(`word${index} `));
      await sleep(250);
    }
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
    return;
  }

  if (prompt.includes("break")) {
    response.write(chunk("Partial part "));
    await sleep(100);
    response.write(
      `data: ${JSON.stringify({
        id: "gen-mock",
        object: "chat.completion.chunk",
        model: "mock/free-model",
        provider: "Mock",
        error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      })}\n\n`,
    );
    response.end();
    return;
  }

  response.write(chunk("Hello from "));
  await sleep(50);
  response.write(chunk("the mock model. "));
  await sleep(50);
  response.write(chunk("Glad to help."));
  response.write(
    `data: ${JSON.stringify({
      id: "gen-mock",
      object: "chat.completion.chunk",
      model: "mock/free-model",
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, cost: 0.000123 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);

  if (request.method === "GET" && url.pathname === "/api/v1/models") {
    return json(response, 200, { data: models, total_count: models.length, links: { next: null } });
  }

  if (request.method === "GET" && url.pathname === "/api/v1/key") {
    if (!authorized(request)) return json(response, 401, { error: { code: 401, message: "Invalid API key" } });
    return json(response, 200, {
      data: {
        label: "sk-or-v1-e2e...3456",
        is_free_tier: false,
        is_management_key: false,
        limit: 25,
        limit_remaining: 24.5,
        usage: 0.5,
        usage_daily: 0.5,
        usage_monthly: 0.5,
        expires_at: null,
      },
    });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/chat/completions") {
    if (!authorized(request)) {
      return json(response, 401, { error: { code: 401, message: "No auth credentials found" } });
    }
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw || "{}");
    const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
    const prompt = String(lastUser?.content ?? "").toLowerCase();
    return streamCompletion(response, prompt);
  }

  return json(response, 404, { error: { code: 404, message: `No mock route for ${request.method} ${url.pathname}` } });
});

server.listen(port, () => {
  console.log(`mock OpenRouter listening on http://localhost:${port}/api/v1`);
});
