// Minimal stand-in for the OpenRouter HTTP API, used by the end-to-end test.
// It mirrors the response shapes documented at openrouter.ai/docs so the app exercises real parsing.
//
// Keys: "sk-or-v1-e2e-valid-key-123456" is accepted; any other key gets a 401.
// Prompt triggers (case-insensitive, in the last user message):
//   "slow"   streams many small chunks slowly, so a test can press Stop
//   "break"  streams partial text, then a mid-stream rate-limit error event
//   otherwise a short reply with usage (20 in / 8 out, cost 0.000123)
// Requests whose system prompt asks for "ONE JSON object" (the planning assistant) get a JSON proposal built from
// the ids found in the prompt, so the app's confirm-then-apply flow runs against real records.
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

const DIMS = 1024;
function hashToken(token) {
  let hash = 2166136261;
  for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % DIMS;
}
// A bag-of-words embedding: texts that share words are close together, which is enough to test retrieval.
function embed(text) {
  const vector = new Array(DIMS).fill(0);
  for (const raw of String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 3) continue;
    vector[hashToken(raw.replace(/(ing|ed|es|s)$/, ""))] += 1;
  }
  return vector;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function streamText(response, text) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  response.write(": OPENROUTER PROCESSING\n\n");
  const middle = Math.ceil(text.length / 2);
  response.write(chunk(text.slice(0, middle)));
  await sleep(30);
  response.write(chunk(text.slice(middle)));
  response.write(
    `data: ${JSON.stringify({ id: "gen-mock", model: "mock/free-model", choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60, cost: 0.0002 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

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

function allMatches(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/**
 * Replies for the agent loop, chosen from the objective and from which steps already appear in the history.
 *   "list"      -> list_tasks, then a summary
 *   "create"    -> create_task, then a confirmation (or an acknowledgement if the user declined)
 *   "delegate"  -> delegate to the Writing Agent, then report its answer
 *   "forever"   -> keeps calling current_date (to hit a step limit)
 *   anything else -> answers directly
 * The delegated agent's objective is "Child job", which it answers directly.
 */
function agentReply(user) {
  const objective = (user.match(/^Objective: (.*)$/m)?.[1] ?? "").toLowerCase();
  const history = user.split("What has happened so far:")[1] ?? "";
  const did = (n) => history.includes(`Step ${n}:`);
  const declined = history.includes("the user declined this action");

  if (objective.includes("forever")) return { thought: "Again.", action: { tool: "current_date", args: {} } };
  if (objective.includes("list")) {
    return did(1) ? { final: "I looked at your tasks and summarized them." } : { thought: "Look at the tasks.", action: { tool: "list_tasks", args: {} } };
  }
  if (objective.includes("create")) {
    if (!did(1)) return { thought: "Create the task.", action: { tool: "create_task", args: { title: "Agent-made task", priority: "high" } } };
    return { final: declined ? "Understood, I did not create the task." : "I created the task." };
  }
  if (objective.includes("delegate")) {
    if (!did(1)) return { thought: "Hand this off.", action: { tool: "delegate", args: { agent: "Writing Agent", objective: "Child job" } } };
    const answer = history.match(/Result: \{"answer":"([^"]*)"/)?.[1] ?? "no answer";
    return { final: `The writing agent said: ${answer}` };
  }
  if (objective.includes("child job")) return { final: "Child answer." };
  return { final: "Done." };
}

/** Builds the JSON a well-behaved model would return for each planning request. */
function structuredReply(system, user) {
  if (system.includes("OMNI agent")) return agentReply(user);
  if (system.includes("careful senior engineer")) {
    const original = /File ([^\n]+):\n([\s\S]*)\n<\/data>/.exec(user);
    const file = original?.[2] ?? "";
    if (system.includes("Make the change the user asks for")) return { explanation: "Added a header comment as asked.", newContent: `# reviewed by the assistant\n${file}` };
    if (system.includes("Write tests")) return { explanation: "Run it with python -m unittest.", newContent: "import unittest\n\nclass T(unittest.TestCase):\n    def test_it(self):\n        self.assertTrue(True)\n" };
    return { explanation: system.includes("Review this file") ? "No serious problems found." : "This file prints a greeting.", newContent: null };
  }
  if (system.includes("plan web searches")) {
    const question = /<data>\n([\s\S]*?)\n<\/data>/.exec(user)?.[1] ?? "question";
    return { queries: [question.slice(0, 80), `${question.slice(0, 60)} overview`] };
  }
  if (system.includes("Plan focused work time")) {
    const dates = /dates (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(system);
    const ids = allMatches(user, /"taskId":"([^"]+)"/g);
    return {
      summary: "Two focused blocks before the deadlines.",
      blocks: ids.slice(0, 2).map((taskId, index) => ({ taskId, date: dates?.[2], start: index === 0 ? "10:00" : "11:30", minutes: 60, reason: "Fits before the deadline." })),
    };
  }
  if (system.includes("You summarize conversations")) {
    return { summary: "A short mock summary of the chat.", keyPoints: ["Mock key point"], actionItems: ["Follow up on the mock chat"] };
  }
  if (system.includes("Write a practical project plan")) {
    return {
      summary: "Start with research, then build.",
      milestones: [{ title: "Research done", dueDate: "2030-01-15" }],
      tasks: [
        { title: "Mock research task", description: "Look into options", priority: "high", milestone: "Research done", subtasks: ["Read docs"] },
        { title: "Mock build task", priority: "medium", dueDate: "2030-02-01", tags: ["build"] },
      ],
    };
  }
  if (system.includes("Break the project down")) {
    return { summary: "Three concrete steps.", tasks: [{ title: "Mock step one", priority: "high" }, { title: "Mock step two" }] };
  }
  if (system.includes("Summarize the note faithfully")) {
    return { summary: "A mock summary of the note.", keyPoints: ["First point", "Second point"], suggestedTags: ["summarized"] };
  }
  if (system.includes("Suggest priorities")) {
    const [first] = allMatches(user, /"taskId":"([^"]+)"/g);
    return { summary: "One task needs attention.", suggestions: first ? [{ taskId: first, priority: "urgent", reason: "It is the most pressing." }] : [] };
  }
  if (system.includes("Organize the tasks")) {
    const projectId = allMatches(user, /"projectId":"([^"]+)","name"/g)[0];
    const unassigned = allMatches(user, /\{"taskId":"([^"]+)"[^}]*"projectId":null/g)[0];
    return {
      summary: "Filed one task.",
      suggestions: unassigned && projectId ? [{ taskId: unassigned, projectId, addTags: ["organized"], reason: "Belongs with this project." }] : [],
    };
  }
  if (system.includes("Organize the notes")) {
    const [first] = allMatches(user, /"noteId":"([^"]+)"/g);
    return { summary: "Filed one note.", suggestions: first ? [{ noteId: first, folder: "Mock Folder", addTags: ["mocked"], reason: "Fits here." }] : [] };
  }
  return { summary: "ok" };
}

async function streamStructured(response, system, user) {
  if (system.includes("OMNI agent") && user.toLowerCase().includes("objective: stall")) {
    // Never answers, so a test can cancel the run while it waits on the model.
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    response.write(": OPENROUTER PROCESSING\n\n");
    while (!response.destroyed) await sleep(100);
    return;
  }
  const text = JSON.stringify(structuredReply(system, user));
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  response.write(chunk(text.slice(0, Math.floor(text.length / 2))));
  await sleep(30);
  response.write(chunk(text.slice(Math.floor(text.length / 2))));
  response.write(
    `data: ${JSON.stringify({
      id: "gen-mock",
      model: "mock/free-model",
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 300, completion_tokens: 120, total_tokens: 420, cost: 0.0005 },
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
    const system = String(body.messages?.find((message) => message.role === "system")?.content ?? "");
    if (Array.isArray(lastUser?.content) && lastUser.content.some((part) => part.type === "image_url")) {
      return streamText(response, "Text in image: INVOICE 4821 total due 310 dollars. The image shows a printed invoice.");
    }
    const userText = typeof lastUser?.content === "string" ? lastUser.content : "";
    if (userText.includes("<attachment name=")) {
      const attached = /<attachment name="([^"]*)">\n([\s\S]*?)\n<\/attachment>/.exec(userText);
      return streamText(response, `I read the attachment ${attached?.[1]}: ${attached?.[2].replace(/\s+/g, " ").slice(0, 80)}`);
    }
    if (userText.toLowerCase().includes("show code")) {
      return streamText(response, "Here you go:\n\n```js\nconst answer = 42;\nfunction greet(name) {\n  return `hi ${name}`; // say hi\n}\n```\n\nDone.");
    }
    if (userText.toLowerCase().includes("compare")) {
      return streamText(response, `Answer from ${body.model}.`);
    }
    if (system.includes("careful research assistant")) {
      const slow = userText.toLowerCase().includes("slow");
      const text = "Solar panels became far cheaper over the decade [1]. Wind turbines followed a similar path [2]. An unsupported claim slipped in [8].";
      if (!slow) return streamText(response, text);
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (let i = 0; i < 60; i += 1) {
        if (response.destroyed) return;
        response.write(chunk(`word${i} `));
        await sleep(250);
      }
      response.end("data: [DONE]\n\n");
      return;
    }
    if (system.includes("<source n=") || system.includes("<memory>")) {
      const source = /<source n="1"[^>]*>\n([\s\S]*?)\n<\/source>/.exec(system)?.[1];
      const memory = /<memory>([\s\S]*?)<\/memory>/.exec(system)?.[1];
      const parts = [];
      if (source) parts.push(`According to your documents [1]: ${source.replace(/\s+/g, " ").slice(0, 120)}`);
      if (memory) parts.push(`I also remember: ${memory.slice(0, 100)}`);
      return streamText(response, parts.join(" "));
    }
    if (system.includes("ONE JSON object")) return streamStructured(response, system, String(lastUser?.content ?? ""));
    const prompt = String(lastUser?.content ?? "").toLowerCase();
    return streamCompletion(response, prompt);
  }

  if (request.method === "GET" && url.pathname === "/searxng/search") {
    const q = url.searchParams.get("q") ?? "";
    if (q.includes("break-search")) return json(response, 502, { error: "search backend down" });
    return json(response, 200, {
      results: [
        { title: "Solar costs", url: `http://localhost:${port}/pages/solar`, content: `Search snippet about ${q}` },
        { title: "Wind costs", url: `http://localhost:${port}/pages/wind`, content: "Wind snippet" },
        { title: "A missing page", url: `http://localhost:${port}/pages/missing`, content: "Snippet from a page that no longer exists" },
      ],
    });
  }
  if (request.method === "GET" && url.pathname.startsWith("/pages/")) {
    const pages = {
      "/pages/solar": ["Solar costs explained", "Solar panels became much cheaper over the last decade as manufacturing scaled up around the world."],
      "/pages/wind": ["Wind costs explained", "Wind turbines also fell in price over the same period, with offshore projects improving the most."],
    };
    const page = pages[url.pathname];
    if (!page) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      return response.end("not found");
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return response.end(`<html><head><title>${page[0]}</title></head><body><nav><a href="/">Home</a></nav><article><p>${page[1]}</p><p>${page[1]} Additional detail makes this long enough to count as real article text for the reader.</p></article></body></html>`);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/embeddings") {
    if (!authorized(request)) return json(response, 401, { error: { code: 401, message: "No auth credentials found" } });
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw || "{}");
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    if (inputs.some((text) => String(text).includes("EMBED_FAIL"))) {
      return json(response, 502, { error: { code: 502, message: "Embedding provider unavailable" } });
    }
    return json(response, 200, {
      object: "list",
      model: body.model,
      data: inputs.map((text, index) => ({ object: "embedding", index, embedding: embed(text) })),
      usage: { prompt_tokens: inputs.length * 10, total_tokens: inputs.length * 10 },
    });
  }

  return json(response, 404, { error: { code: 404, message: `No mock route for ${request.method} ${url.pathname}` } });
});

server.listen(port, () => {
  console.log(`mock OpenRouter listening on http://localhost:${port}/api/v1`);
});
