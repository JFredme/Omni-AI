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
