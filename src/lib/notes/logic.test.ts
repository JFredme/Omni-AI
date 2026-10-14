import { describe, expect, it } from "vitest";
import { countWords, displayTitle, insertSummary, makeExcerpt } from "./logic";

describe("note logic", () => {
  it("strips Markdown syntax from excerpts", () => {
    const excerpt = makeExcerpt("# Title\n\nSome **bold** and `code` with a [link](https://x.test).\n\n- item one\n> quote");
    expect(excerpt).toBe("Title Some bold and code with a link. item one quote");
  });

  it("drops fenced code blocks and keeps image alt text", () => {
    expect(makeExcerpt("before\n```js\nconst a = 1;\n```\nafter ![diagram](a.png)")).toBe("before after diagram");
  });

  it("truncates long excerpts with an ellipsis", () => {
    const excerpt = makeExcerpt("word ".repeat(100), 20);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(21);
  });

  it("falls back to Untitled and counts words", () => {
    expect(displayTitle({ title: "  " })).toBe("Untitled");
    expect(displayTitle({ title: "Ideas" })).toBe("Ideas");
    expect(countWords("")).toBe(0);
    expect(countWords("  two   words\nhere ")).toBe(3);
  });
});

describe("insertSummary", () => {
  it("places a Summary section above the existing note", () => {
    const result = insertSummary("# Meeting\nBody", { summary: "We agreed.", keyPoints: ["Ship Friday", "Review later"] });
    expect(result).toContain("## Summary\n\nWe agreed.\n\n- Ship Friday\n- Review later");
    expect(result.endsWith("# Meeting\nBody")).toBe(true);
  });

  it("replaces an earlier summary instead of stacking another", () => {
    const first = insertSummary("Body", { summary: "One", keyPoints: [] });
    const second = insertSummary(first, { summary: "Two", keyPoints: [] });
    expect(second).toContain("Two");
    expect(second).not.toContain("One");
    expect(second.match(/## Summary/g)).toHaveLength(1);
    expect(second.endsWith("Body")).toBe(true);
  });

  it("works on an empty note", () => {
    expect(insertSummary("", { summary: "Only this", keyPoints: [] })).toContain("Only this");
  });
});
