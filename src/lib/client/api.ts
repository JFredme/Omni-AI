import { SseParser } from "@/lib/sse";
import type { TurnEvent } from "@/lib/chat/types";

export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string })?.name === "AbortError";
}

async function toClientError(response: Response): Promise<ClientApiError> {
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return new ClientApiError(
    data?.error?.message ?? `The request failed with HTTP ${response.status}.`,
    response.status,
    data?.error?.code ?? "unknown",
  );
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; json?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.json !== undefined ? "POST" : "GET"),
    headers: options.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    signal: options.signal,
  });
  if (!response.ok) throw await toClientError(response);
  return (await response.json()) as T;
}

/** Posts to a server-sent-events endpoint and calls `onEvent` for each event, shaped `{ type, ...payload }`. */
export async function streamEvents<T extends { type: string }>(
  path: string,
  body: unknown,
  options: { signal: AbortSignal; onEvent: (event: T) => void },
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) throw await toClientError(response);
  if (!response.body) throw new ClientApiError("The server returned an empty stream.", response.status, "unknown");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  const dispatch = (events: { event: string; data: string }[]) => {
    for (const event of events) {
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      options.onEvent({ type: event.event, ...payload } as T);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    dispatch(parser.feed(decoder.decode(value, { stream: true })));
  }
  dispatch(parser.flush());
}

/** Posts to a streaming turn endpoint and calls `onEvent` for each server-sent event. */
export function streamTurn(path: string, body: unknown, options: { signal: AbortSignal; onEvent: (event: TurnEvent) => void }): Promise<void> {
  return streamEvents<TurnEvent>(path, body, options);
}
