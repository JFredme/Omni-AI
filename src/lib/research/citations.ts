import type { SourceDto } from "./types";

/** Stops page text from closing the tag it sits in and being read as instructions. */
export function fenceSource(text: string): string {
  return text.replace(/<\/?source\b/gi, (match) => match.replace("<", "‹"));
}

export function sourcesBlock(sources: { n: number; title: string; url: string; text: string }[]): string {
  return sources
    .map((source) => `<source n="${source.n}" title="${source.title.replace(/"/g, "'").slice(0, 200)}" url="${source.url}">\n${fenceSource(source.text)}\n</source>`)
    .join("\n");
}

/**
 * Checks a finished report's citations against the sources it was actually given. A number that doesn't match a source
 * is removed (a model can invent them), and each source is marked as cited or not.
 */
export function validateCitations(report: string, sources: SourceDto[]): { report: string; sources: SourceDto[]; removed: number } {
  const valid = new Set(sources.map((source) => source.n));
  const cited = new Set<number>();
  let removed = 0;
  // Code is left alone: `items[1]` is not a citation.
  const cleaned = report
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        // [3], [1,2], [1][2]
        .replace(/\[([1-9]\d{0,2}(?:\s*,\s*[1-9]\d{0,2})*)\]/g, (_match, list: string) => {
          const numbers = list.split(",").map((value) => Number(value.trim()));
          const keep = numbers.filter((n) => valid.has(n));
          removed += numbers.length - keep.length;
          for (const n of keep) cited.add(n);
          return keep.length ? keep.map((n) => `[${n}]`).join("") : "";
        })
        .replace(/ {2,}/g, " ")
        .replace(/ +([.,;:!?])/g, "$1");
    })
    .join("");
  return { report: cleaned, sources: sources.map((source) => ({ ...source, cited: cited.has(source.n) })), removed };
}

/** Turns [n] into a link to that source on the same page, for display. Only numbers that match a source become links. */
export function linkCitations(report: string, sourceCount: number): string {
  return report.replace(/\[(\d{1,3})\](?!\()/g, (match, value: string) => (Number(value) >= 1 && Number(value) <= sourceCount ? `[${value}](#source-${value})` : match));
}
