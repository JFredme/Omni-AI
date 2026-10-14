import { describe, expect, it } from "vitest";
import { encodeSseEvent, SseParser } from "@/lib/sse";

describe("SseParser", () => {
  it("parses data events separated by blank lines", () => {
    const parser = new SseParser();
    const events = parser.feed('data: {"a":1}\n\ndata: [DONE]\n\n');
    expect(events).toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "message", data: "[DONE]" },
    ]);
  });

  it("handles chunks split at any byte boundary", () => {
    const payload = 'event: delta\ndata: {"text":"héllo"}\n\n';
    const parser = new SseParser();
    const events: { event: string; data: string }[] = [];
    for (const char of payload) {
      events.push(...parser.feed(char));
    }
    expect(events).toEqual([{ event: "delta", data: '{"text":"héllo"}' }]);
  });

  it("supports CRLF line endings and ignores comments", () => {
    const parser = new SseParser();
    const events = parser.feed(": OPENROUTER PROCESSING\r\ndata: ok\r\n\r\n");
    expect(events).toEqual([{ event: "message", data: "ok" }]);
  });

  it("joins multi-line data fields", () => {
    const parser = new SseParser();
    expect(parser.feed("data: first\ndata: second\n\n")).toEqual([
      { event: "message", data: "first\nsecond" },
    ]);
  });

  it("emits a trailing event on flush when the stream ends without a blank line", () => {
    const parser = new SseParser();
    expect(parser.feed("data: tail")).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "message", data: "tail" }]);
  });

  it("round-trips events produced by encodeSseEvent", () => {
    const parser = new SseParser();
    const encoded = encodeSseEvent("done", { messageId: "m1", text: "a\nb" });
    const [event] = parser.feed(encoded);
    expect(event.event).toBe("done");
    expect(JSON.parse(event.data)).toEqual({ messageId: "m1", text: "a\nb" });
  });
});
