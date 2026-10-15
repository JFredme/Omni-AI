import { describe, expect, it } from "vitest";
import { shouldSearchWeb, webCitations } from "./web";

describe("shouldSearchWeb", () => {
  it("always searches when on and never when off", () => {
    expect(shouldSearchWeb("hello", "on")).toBe(true);
    expect(shouldSearchWeb("latest news today", "off")).toBe(false);
  });
  it("in auto mode, searches only for questions that need fresh information", () => {
    expect(shouldSearchWeb("What's the weather in Boston tomorrow?", "auto")).toBe(true);
    expect(shouldSearchWeb("latest iPhone release date", "auto")).toBe(true);
    expect(shouldSearchWeb("search for good pizza dough recipes", "auto")).toBe(true);
    expect(shouldSearchWeb("summarize https://example.com/post", "auto")).toBe(true);
    expect(shouldSearchWeb("Explain how recursion works", "auto")).toBe(false);
    expect(shouldSearchWeb("hi", "auto")).toBe(false);
  });
});

describe("webCitations", () => {
  it("numbers pages after existing citations and drops repeats", () => {
    const existing = [{ n: 2, kind: "source" as const, documentId: "d", name: "Doc", page: null, heading: null, snippet: "", score: 0.9 }];
    const out = webCitations(
      [
        { url: "https://a.com", title: "A", snippet: "x" },
        { url: "https://a.com", title: "A again", snippet: "x" },
        { url: "https://b.com", title: "B", snippet: "y" },
      ],
      existing,
    );
    expect(out.map((c) => [c.n, c.url])).toEqual([[3, "https://a.com"], [4, "https://b.com"]]);
  });
});
