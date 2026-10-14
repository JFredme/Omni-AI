import { describe, expect, it } from "vitest";
import { buildRequestMessages, deriveTitle, DEFAULT_CONVERSATION_TITLE } from "@/lib/chat/history";

describe("buildRequestMessages", () => {
  it("prepends a trimmed system prompt and keeps chronological order", () => {
    const messages = buildRequestMessages({
      systemPrompt: "  Be brief.  ",
      history: [
        { role: "user", content: "one", status: "complete" },
        { role: "assistant", content: "two", status: "complete" },
        { role: "user", content: "three", status: "complete" },
      ],
    });
    expect(messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
  });

  it("omits failed, in-progress, and empty replies", () => {
    const messages = buildRequestMessages({
      systemPrompt: null,
      history: [
        { role: "user", content: "question", status: "complete" },
        { role: "assistant", content: "partial error text", status: "error" },
        { role: "assistant", content: "", status: "stopped" },
        { role: "assistant", content: "still going", status: "streaming" },
        { role: "user", content: "follow-up", status: "complete" },
      ],
    });
    expect(messages.map((message) => message.content)).toEqual(["question", "follow-up"]);
  });

  it("drops the oldest messages to stay within the character budget", () => {
    const messages = buildRequestMessages({
      systemPrompt: null,
      maxChars: 25,
      history: [
        { role: "user", content: "a".repeat(10), status: "complete" },
        { role: "assistant", content: "b".repeat(10), status: "complete" },
        { role: "user", content: "c".repeat(10), status: "complete" },
      ],
    });
    expect(messages.map((message) => message.content)).toEqual(["b".repeat(10), "c".repeat(10)]);
  });

  it("always keeps the newest message even when it alone exceeds the budget", () => {
    const messages = buildRequestMessages({
      systemPrompt: null,
      maxChars: 5,
      history: [{ role: "user", content: "x".repeat(50), status: "complete" }],
    });
    expect(messages).toHaveLength(1);
  });
});

describe("deriveTitle", () => {
  it("uses the first non-empty line, collapsing whitespace", () => {
    expect(deriveTitle("\n   Plan   my\tweek \nmore text")).toBe("Plan my week");
  });

  it("truncates long titles with an ellipsis", () => {
    const title = deriveTitle("word ".repeat(40));
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("falls back to the default title for blank input", () => {
    expect(deriveTitle("   \n  ")).toBe(DEFAULT_CONVERSATION_TITLE);
  });
});
