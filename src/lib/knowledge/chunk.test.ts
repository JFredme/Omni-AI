import { describe, expect, it } from "vitest";
import { chunkPages, chunkTable, chunkText } from "./chunk";

const paragraph = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");

describe("chunkText", () => {
  it("keeps short text in one chunk", () => {
    expect(chunkText("Hello there.\n\nSecond paragraph.")).toEqual([{ content: "Hello there.\n\nSecond paragraph.", heading: null, page: null }]);
  });

  it("splits long text on paragraph boundaries near the target size, with overlap", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(`p${i}w`, 40)).join("\n\n");
    const chunks = chunkText(text, { target: 600, overlap: 80 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(600 * 1.4 + 100);
    // Overlap: each chunk after the first starts with words from the end of the one before.
    const firstWordOfSecond = chunks[1].content.split(/\s+/)[0];
    expect(chunks[0].content).toContain(firstWordOfSecond);
  });

  it("never loses text", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const joined = chunkText(text, { target: 200, overlap: 0 }).map((c) => c.content).join(" ");
    for (let i = 0; i < 30; i++) expect(joined).toContain(`number ${i} is`);
  });

  it("splits a single giant block with no breaks", () => {
    const chunks = chunkText("x".repeat(5000), { target: 1000, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.map((c) => c.content).join("").length).toBe(5000);
  });

  it("tracks the nearest Markdown heading", () => {
    const text = `# Guide\n\nIntro text.\n\n## Setup\n\n${paragraph("setup", 120)}\n\n## Usage\n\n${paragraph("usage", 120)}`;
    const chunks = chunkText(text, { target: 500, overlap: 0 });
    expect(chunks.find((c) => c.content.includes("setup3"))?.heading).toBe("Setup");
    expect(chunks.find((c) => c.content.includes("usage3"))?.heading).toBe("Usage");
  });

  it("returns nothing for blank input", () => {
    expect(chunkText("  \n\n \n")).toEqual([]);
  });
});

describe("chunkPages", () => {
  it("keeps page numbers", () => {
    const chunks = chunkPages([
      { page: 1, text: "First page text." },
      { page: 2, text: "Second page text." },
    ]);
    expect(chunks.map((c) => c.page)).toEqual([1, 2]);
  });
});

describe("chunkTable", () => {
  it("repeats the header in every chunk and keeps every row", () => {
    const rows = [["name", "qty"], ...Array.from({ length: 200 }, (_, i) => [`item${i}`, String(i)])];
    const chunks = chunkTable(rows, { target: 400, name: "Stock" });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.content.startsWith("name | qty")).toBe(true);
      expect(chunk.heading).toBe("Stock");
    }
    const all = chunks.map((c) => c.content).join("\n");
    for (let i = 0; i < 200; i++) expect(all).toContain(`item${i} |`);
  });

  it("handles a header-only table", () => {
    expect(chunkTable([["a", "b"]]).map((c) => c.content)).toEqual(["a | b"]);
  });
});
