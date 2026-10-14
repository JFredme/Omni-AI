import type { Block, DocumentModel } from "./model";

/** A run of text with its inline formatting. */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

/** Splits inline Markdown (**bold**, *italic*, `code`, [text](url)) into formatted runs. Unmatched markers stay as text. */
export function parseInline(input: string): Run[] {
  const runs: Run[] = [];
  const pattern = /(\*\*(?!\s)[^*\n]+?(?<!\s)\*\*|__(?!\s)[^_\n]+?(?<!\s)__|(?<![*\w])\*(?!\s)[^*\n]+?(?<!\s)\*(?![*\w])|(?<![_\w])_(?!\s)[^_\n]+?(?<!\s)_(?![_\w])|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  for (const match of input.matchAll(pattern)) {
    if (match.index > last) runs.push({ text: input.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith("`")) runs.push({ text: token.slice(1, -1), code: true });
    else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      runs.push({ text: link[1], link: link[2] });
    } else runs.push({ text: token.slice(1, -1), italic: true });
    last = match.index + token.length;
  }
  if (last < input.length) runs.push({ text: input.slice(last) });
  return runs.length ? runs : [{ text: "" }];
}

/** Inline Markdown with the markers removed. */
export const plainInline = (input: string) => parseInline(input).map((run) => run.text).join("");

const tableRow = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Turns Markdown into document blocks: headings, paragraphs, lists, tables, and code. HTML and images are skipped. */
export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: Math.min(3, heading[1].length) as 1 | 2 | 3, text: plainInline(heading[2]) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flush();
      const header = tableRow(line).map(plainInline);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(tableRow(lines[i]).map(plainInline));
      i -= 1;
      blocks.push({ type: "table", header: header.length ? header : [""], rows });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? "bullets" : "numbered";
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = kind === "bullets" ? /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(lines[i]) : /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[1].trim());
      }
      i -= 1;
      blocks.push({ type: kind, items });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      paragraph.push(quote[1]);
      continue;
    }
    if (/^\s*!?\[[^\]]*\]\([^)]*\)\s*$/.test(line) && line.trim().startsWith("!")) continue; // an image on its own line
    paragraph.push(line.trim());
  }
  flush();
  return blocks.filter((block) => block.type !== "paragraph" || block.text);
}

export function blocksToMarkdown(doc: DocumentModel): string {
  const out: string[] = [`# ${doc.title}`, ""];
  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading":
        out.push(`${"#".repeat(block.level + 1)} ${block.text}`, "");
        break;
      case "paragraph":
        out.push(block.text, "");
        break;
      case "bullets":
        out.push(...block.items.map((item) => `- ${item}`), "");
        break;
      case "numbered":
        out.push(...block.items.map((item, index) => `${index + 1}. ${item}`), "");
        break;
      case "table":
        out.push(`| ${block.header.join(" | ")} |`, `| ${block.header.map(() => "---").join(" | ")} |`, ...block.rows.map((row) => `| ${row.join(" | ")} |`), "");
        break;
      case "code":
        out.push("```", block.text, "```", "");
        break;
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function blocksToText(doc: DocumentModel): string {
  const out: string[] = [doc.title, "=".repeat(Math.min(doc.title.length, 60)), ""];
  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading":
        out.push(block.text.toUpperCase(), "");
        break;
      case "paragraph":
        out.push(plainInline(block.text), "");
        break;
      case "bullets":
        out.push(...block.items.map((item) => `  • ${plainInline(item)}`), "");
        break;
      case "numbered":
        out.push(...block.items.map((item, index) => `  ${index + 1}. ${plainInline(item)}`), "");
        break;
      case "table":
        out.push(block.header.join("\t"), ...block.rows.map((row) => row.join("\t")), "");
        break;
      case "code":
        out.push(...block.text.split("\n").map((line) => `    ${line}`), "");
        break;
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}
