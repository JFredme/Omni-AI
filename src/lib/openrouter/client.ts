import { getOpenRouterBaseUrl } from "@/lib/env";
import { SseParser } from "@/lib/sse";
import {
  OpenRouterError,
  classifyOpenRouterError,
  parseErrorBody,
  type OpenRouterErrorKind,
} from "./errors";
import { normalizeModel, type CatalogModel } from "./models";

const APP_TITLE = "OMNI AI";
export const REQUEST_TIMEOUT_MS = 20_000;
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Credits reported by OpenRouter for this generation (USD), when present. */
  cost: number | null;
}

export interface WebSource {
  url: string;
  title: string;
  snippet: string;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "web"; sources: WebSource[] }
  | { type: "usage"; usage: UsageInfo }
  | { type: "finish"; reason: string | null };

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatRequestBody {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string | ContentPart[] }[];
  temperature?: number;
  /** OpenRouter plugins. `{ id: "web" }` lets the model search the live web (answers then cite their sources). */
  plugins?: { id: string; max_results?: number }[];
}

/** Pulls the web pages OpenRouter attached to a reply (`annotations` of type `url_citation`). */
export function webSourcesFrom(annotations: unknown): WebSource[] {
  if (!Array.isArray(annotations)) return [];
  const out: WebSource[] = [];
  for (const item of annotations) {
    const note = item as { type?: unknown; url_citation?: { url?: unknown; title?: unknown; content?: unknown } };
    const cite = note?.type === "url_citation" ? note.url_citation : null;
    if (!cite || typeof cite.url !== "string" || !/^https?:\/\//i.test(cite.url)) continue;
    out.push({
      url: cite.url,
      title: typeof cite.title === "string" && cite.title.trim() ? cite.title.trim().slice(0, 200) : new URL(cite.url).hostname,
      snippet: typeof cite.content === "string" ? cite.content.replace(/\s+/g, " ").trim().slice(0, 400) : "",
    });
  }
  return out;
}

export interface KeyInfo {
  label: string;
  isFreeTier: boolean;
  isManagementKey: boolean;
  limit: number | null;
  limitRemaining: number | null;
  usage: number;
  usageDaily: number;
  usageMonthly: number;
  expiresAt: string | null;
}

export function headersFor(apiKey: string | null, json: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-OpenRouter-Title": APP_TITLE,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function retryAfterSeconds(response: Response): number | null {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function errorFromResponse(response: Response): Promise<OpenRouterError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const parsed = parseErrorBody(body, `OpenRouter responded with HTTP ${response.status}.`);
  const kind: OpenRouterErrorKind = classifyOpenRouterError(response.status, parsed.errorType, parsed.limitSource);
  return new OpenRouterError(parsed.message, {
    kind,
    status: response.status,
    errorType: parsed.errorType,
    retryAfterSeconds: retryAfterSeconds(response),
  });
}

/** Rejects with an AbortError as soon as `signal` fires, even if the wrapped promise never settles. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = () => new DOMException("The operation was aborted.", "AbortError");
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function networkError(error: unknown, timedOut: boolean): OpenRouterError {
  if (timedOut) {
    return new OpenRouterError("The request to OpenRouter timed out.", { kind: "timeout" });
  }
  const message = error instanceof Error ? error.message : "Network request failed.";
  return new OpenRouterError(message, { kind: "network" });
}

async function requestJson(
  path: string,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const response = await fetch(`${getOpenRouterBaseUrl()}${path}`, {
      method: "GET",
      headers: headersFor(apiKey, false),
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    return await response.json();
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    if (signal?.aborted) throw error;
    throw networkError(error, timedOut);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchModelCatalog(options: { apiKey?: string | null; signal?: AbortSignal } = {}): Promise<CatalogModel[]> {
  const payload = (await requestJson("/models?output_modalities=text", options.apiKey ?? null, options.signal)) as {
    data?: unknown;
  };
  if (!Array.isArray(payload?.data)) {
    throw new OpenRouterError("OpenRouter returned an unexpected model list.", { kind: "unknown" });
  }
  return payload.data.map(normalizeModel).filter((model): model is CatalogModel => model !== null);
}

export async function fetchKeyInfo(apiKey: string, signal?: AbortSignal): Promise<KeyInfo> {
  const payload = (await requestJson("/key", apiKey, signal)) as { data?: Record<string, unknown> };
  const data = payload?.data;
  if (!data || typeof data.label !== "string") {
    throw new OpenRouterError("OpenRouter returned an unexpected key response.", { kind: "unknown" });
  }
  return {
    label: data.label,
    isFreeTier: data.is_free_tier === true,
    isManagementKey: data.is_management_key === true,
    limit: numberOrNull(data.limit),
    limitRemaining: numberOrNull(data.limit_remaining),
    usage: numberOrNull(data.usage) ?? 0,
    usageDaily: numberOrNull(data.usage_daily) ?? 0,
    usageMonthly: numberOrNull(data.usage_monthly) ?? 0,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
  };
}

function usageFrom(raw: Record<string, unknown>): UsageInfo {
  const promptTokens = numberOrNull(raw.prompt_tokens) ?? 0;
  const completionTokens = numberOrNull(raw.completion_tokens) ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: numberOrNull(raw.total_tokens) ?? promptTokens + completionTokens,
    cost: numberOrNull(raw.cost),
  };
}

function errorFromStreamPayload(error: Record<string, unknown>): OpenRouterError {
  const metadata = (error.metadata ?? {}) as { error_type?: unknown; limit_source?: unknown };
  const errorType = typeof metadata.error_type === "string" ? metadata.error_type : null;
  const limitSource = typeof metadata.limit_source === "string" ? metadata.limit_source : null;
  const status = numberOrNull(error.code);
  const message = typeof error.message === "string" && error.message ? error.message : "The model stopped with an error.";
  return new OpenRouterError(message, {
    kind: classifyOpenRouterError(status, errorType, limitSource),
    status,
    errorType,
  });
}

/**
 * Streams a chat completion from OpenRouter, yielding normalized events.
 * Throws OpenRouterError for upstream failures (including mid-stream error events).
 * Throws the caller's AbortError when `signal` is aborted.
 */
export async function* streamChatCompletion(params: {
  apiKey: string;
  body: ChatRequestBody;
  signal: AbortSignal;
  idleTimeoutMs?: number;
}): AsyncGenerator<StreamEvent> {
  const controller = new AbortController();
  const idleTimeoutMs = params.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  const onCallerAbort = () => controller.abort();
  if (params.signal.aborted) controller.abort();
  params.signal.addEventListener("abort", onCallerAbort, { once: true });
  armIdleTimer();

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let response: Response;
    try {
      response = await untilAborted(
        fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
          method: "POST",
          headers: headersFor(params.apiKey, true),
          body: JSON.stringify({ ...params.body, stream: true }),
          signal: controller.signal,
        }),
        controller.signal,
      );
    } catch (error) {
      if (params.signal.aborted) throw error;
      throw networkError(error, timedOut);
    }
    armIdleTimer();

    if (!response.ok) throw await errorFromResponse(response);
    if (!response.body) {
      throw new OpenRouterError("OpenRouter returned an empty response.", { kind: "provider_error" });
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let finished = false;

    const handleEvents = function* (events: { data: string }[]): Generator<StreamEvent, boolean> {
      for (const event of events) {
        if (event.data === "[DONE]") return true;

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          throw new OpenRouterError("OpenRouter sent a malformed stream event.", { kind: "provider_error" });
        }

        if (payload.error && typeof payload.error === "object") {
          throw errorFromStreamPayload(payload.error as Record<string, unknown>);
        }
        if (payload.usage && typeof payload.usage === "object") {
          yield { type: "usage", usage: usageFrom(payload.usage as Record<string, unknown>) };
        }

        const choices = Array.isArray(payload.choices) ? (payload.choices as Record<string, unknown>[]) : [];
        const choice = choices[0];
        if (!choice) continue;

        if (choice.error && typeof choice.error === "object") {
          throw errorFromStreamPayload(choice.error as Record<string, unknown>);
        }
        const delta = choice.delta as { content?: unknown; annotations?: unknown } | undefined;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          yield { type: "delta", text: delta.content };
        }
        const web = webSourcesFrom(delta?.annotations);
        if (web.length > 0) yield { type: "web", sources: web };
        if (typeof choice.finish_reason === "string") {
          finished = true;
          yield { type: "finish", reason: choice.finish_reason };
        }
      }
      return false;
    };

    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await untilAborted(reader.read(), controller.signal);
      } catch (error) {
        if (params.signal.aborted) throw error;
        throw networkError(error, timedOut);
      }
      armIdleTimer();
      if (read.done) break;

      const sawDone = yield* handleEvents(parser.feed(decoder.decode(read.value, { stream: true })));
      if (sawDone) return;
    }

    const sawDone = yield* handleEvents(parser.flush());
    if (!sawDone && !finished) {
      throw new OpenRouterError("The model stream ended before it finished.", { kind: "provider_error" });
    }
  } finally {
    clearTimeout(idleTimer);
    params.signal.removeEventListener("abort", onCallerAbort);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The stream is already closed or errored.
      }
    }
    controller.abort();
  }
}


export interface EmbeddingResult {
  vectors: number[][];
  usage: UsageInfo;
}

/** Turns each input text into a vector. Throws OpenRouterError for upstream failures. */
export async function createEmbeddings(params: {
  apiKey: string;
  model: string;
  input: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<EmbeddingResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs ?? 60_000);
  const onCallerAbort = () => controller.abort();
  params.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const response = await fetch(`${getOpenRouterBaseUrl()}/embeddings`, {
      method: "POST",
      headers: headersFor(params.apiKey, true),
      body: JSON.stringify({ model: params.model, input: params.input, encoding_format: "float" }),
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    const payload = (await response.json()) as { data?: { index?: number; embedding?: unknown }[]; usage?: Record<string, unknown> };
    if (!Array.isArray(payload.data) || payload.data.length !== params.input.length) {
      throw new OpenRouterError("The embedding model returned an unexpected response.", { kind: "provider_error" });
    }
    const ordered = [...payload.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = ordered.map((entry) => {
      if (!Array.isArray(entry.embedding) || entry.embedding.length === 0 || !entry.embedding.every((n) => typeof n === "number" && Number.isFinite(n))) {
        throw new OpenRouterError("The embedding model returned an invalid vector.", { kind: "provider_error" });
      }
      return entry.embedding as number[];
    });
    return { vectors, usage: usageFrom(payload.usage ?? {}) };
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    if (params.signal?.aborted) throw error;
    throw networkError(error, timedOut);
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onCallerAbort);
  }
}
