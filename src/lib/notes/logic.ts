export const EXCERPT_LENGTH = 160;

/** A plain-text preview of Markdown: syntax characters removed, whitespace collapsed, then truncated. */
export function makeExcerpt(markdown: string, maxLength = EXCERPT_LENGTH): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trimEnd()}…` : plain;
}

/** The title shown for a note, or "Untitled" when it has none. */
export function displayTitle(note: { title: string }): string {
  return note.title.trim() || "Untitled";
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

const SUMMARY_START = "<!-- omni-summary -->";
const SUMMARY_END = "<!-- /omni-summary -->";
const SUMMARY_PATTERN = new RegExp(`${SUMMARY_START}[\\s\\S]*?${SUMMARY_END}\\s*`);

/**
 * Puts a confirmed AI summary at the top of a note as a "Summary" section. A summary added earlier by this
 * function is replaced rather than stacked, so summarizing again refreshes it.
 */
export function insertSummary(content: string, summary: { summary: string; keyPoints: string[] }): string {
  const lines = [SUMMARY_START, "## Summary", "", summary.summary.trim()];
  if (summary.keyPoints.length > 0) lines.push("", ...summary.keyPoints.map((point) => `- ${point}`));
  lines.push(SUMMARY_END);

  const rest = content.replace(SUMMARY_PATTERN, "").replace(/^\s+/, "");
  return rest ? `${lines.join("\n")}\n\n${rest}` : `${lines.join("\n")}\n`;
}
