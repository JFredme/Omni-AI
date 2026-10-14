import { describe, expect, it } from "vitest";
import { blocksToMarkdown, blocksToText, markdownToBlocks, parseInline, plainInline } from "./markdown";

describe("parseInline", () => {
  it("finds bold, italic, code and links, and keeps the text around them", () => {
    expect(parseInline("A **bold** and *slanted* word, `code`, and [a link](https://x.test).")).toEqual([
      { text: "A " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "slanted", italic: true },
      { text: " word, " },
      { text: "code", code: true },
      { text: ", and " },
      { text: "a link", link: "https://x.test" },
      { text: "." },
    ]);
  });

  it("leaves unmatched markers alone", () => {
    expect(plainInline("2 * 3 = 6 and a_b_c and **unclosed")).toBe("2 * 3 = 6 and a_b_c and **unclosed");
    expect(parseInline("")).toEqual([{ text: "" }]);
  });
});

const sample = `# Title here

Some intro text that
wraps over two lines.

## Section

- first **point**
- second point
* third point

1. step one
2. step two

| Name | Qty |
| --- | ---: |
| Apples | 3 |
| Pears | 5 |

\`\`\`js
const x = 1;

console.log(x);
\`\`\`

> A quoted line.

---

![diagram](a.png)

Final words.
`;

describe("markdownToBlocks", () => {
  const blocks = markdownToBlocks(sample);

  it("reads headings, paragraphs, lists, tables, code, and quotes in order", () => {
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "bullets", "numbered", "table", "code", "paragraph", "paragraph"]);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Title here" });
    expect(blocks[1]).toEqual({ type: "paragraph", text: "Some intro text that wraps over two lines." });
    expect(blocks[3]).toMatchObject({ type: "bullets", items: ["first **point**", "second point", "third point"] });
    expect(blocks[4]).toEqual({ type: "numbered", items: ["step one", "step two"] });
    expect(blocks[5]).toEqual({ type: "table", header: ["Name", "Qty"], rows: [["Apples", "3"], ["Pears", "5"]] });
    expect(blocks[6]).toEqual({ type: "code", text: "const x = 1;\n\nconsole.log(x);" });
    expect(blocks[7]).toEqual({ type: "paragraph", text: "A quoted line." });
    expect(blocks[8]).toEqual({ type: "paragraph", text: "Final words." });
  });

  it("starts a new list for the second list type, and caps heading levels at three", () => {
    const result = markdownToBlocks("- a\n- b\n\n1. c\n\n#### Deep\n");
    expect(result.map((b) => b.type)).toEqual(["bullets", "numbered", "heading"]);
    expect(result[2]).toEqual({ type: "heading", level: 3, text: "Deep" });
  });

  it("drops comments (such as note summary markers), checkboxes' brackets, and empty input", () => {
    expect(markdownToBlocks("<!-- omni-summary -->\nText\n<!-- /omni-summary -->")).toEqual([{ type: "paragraph", text: "Text" }]);
    expect(markdownToBlocks("- [ ] todo\n- [x] done")).toEqual([{ type: "bullets", items: ["todo", "done"] }]);
    expect(markdownToBlocks("")).toEqual([]);
  });
});

describe("blocksToMarkdown and blocksToText", () => {
  const doc = { title: "Report", blocks: markdownToBlocks(sample) };

  it("round-trips the structure through Markdown", () => {
    const md = blocksToMarkdown(doc);
    expect(md.startsWith("# Report\n")).toBe(true);
    expect(markdownToBlocks(md).slice(1).map((b) => b.type)).toEqual(doc.blocks.map((b) => b.type));
    expect(md).toContain("| Name | Qty |");
  });

  it("writes readable plain text with the formatting markers removed", () => {
    const text = blocksToText(doc);
    expect(text).toContain("Report\n======");
    expect(text).toContain("  • first point");
    expect(text).toContain("  1. step one");
    expect(text).not.toContain("**");
  });
});
