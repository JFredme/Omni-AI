export const DEFAULT_CONVERSATION_TITLE = "New chat";
export const MAX_TITLE_LENGTH = 60;
export const MAX_REQUEST_CHARS = 200_000;

import type { ContentPart } from "@/lib/openrouter/client";

export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "stopped" | "error";
  /** Images attached to this message, as data URLs. */
  images?: string[];
}

export interface RequestMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** An image costs roughly this many characters of the request budget. */
const IMAGE_COST_CHARS = 2_000;

/**
 * Builds the messages sent to the model: the system prompt, then as much recent history as fits
 * within `maxChars`. The newest message is always kept. Failed and empty replies are omitted.
 */
export function buildRequestMessages(options: {
  systemPrompt: string | null;
  history: ChatMessageInput[];
  maxChars?: number;
}): RequestMessage[] {
  const maxChars = options.maxChars ?? MAX_REQUEST_CHARS;
  const system: { role: "system"; content: string }[] = options.systemPrompt?.trim() ? [{ role: "system", content: options.systemPrompt.trim() }] : [];
  const usable = options.history
    .filter((message) => message.status !== "error" && message.status !== "streaming")
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      text: message.content,
      images: message.images ?? [],
    }));

  let budget = maxChars - system.reduce((total, message) => total + message.content.length, 0);
  const kept: RequestMessage[] = [];
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const message = usable[index];
    const cost = message.text.length + message.images.length * IMAGE_COST_CHARS;
    if (kept.length > 0 && cost > budget) break;
    kept.unshift({
      role: message.role,
      content:
        message.images.length > 0
          ? [{ type: "text", text: message.text }, ...message.images.map((url) => ({ type: "image_url" as const, image_url: { url } }))]
          : message.text,
    });
    budget -= cost;
  }
  return [...system, ...kept];
}

export function deriveTitle(content: string): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return DEFAULT_CONVERSATION_TITLE;
  const collapsed = firstLine.replace(/\s+/g, " ");
  return collapsed.length > MAX_TITLE_LENGTH ? `${collapsed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : collapsed;
}
