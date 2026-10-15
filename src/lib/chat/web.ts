// When should a reply look at the live web? "auto" searches only for questions that need fresh information.
import type { Citation } from "@/lib/knowledge/types";
import type { WebSource } from "@/lib/openrouter/client";

export const WEB_MODES = ["auto", "on", "off"] as const;
export type WebMode = (typeof WEB_MODES)[number];

const FRESH_WORDS =
  /\b(latest|newest|recent(ly)?|current(ly)?|today|tonight|tomorrow|yesterday|this (week|weekend|month|year|morning|evening)|right now|breaking|news|headlines?|weather|forecast|score|scores|standings|price of|stock|stocks|share price|exchange rate|bitcoin|crypto|release date|released|trending|who won|who is the (current )?(president|ceo|prime minister)|election|results?|open now|near me|opening hours|live|update[sd]?|2025|2026|2027)\b/i;

export function shouldSearchWeb(text: string, mode: WebMode): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;
  if (/^\s*(search|google|look up|look this up|find online)\b/i.test(trimmed)) return true;
  if (/https?:\/\/\S+/i.test(trimmed)) return true;
  return FRESH_WORDS.test(trimmed);
}

/** Web pages become numbered citations after any knowledge-base ones, without repeating an address. */
export function webCitations(sources: WebSource[], existing: Citation[]): Citation[] {
  const seen = new Set(existing.filter((c) => c.kind === "web").map((c) => c.url));
  let n = existing.reduce((max, c) => Math.max(max, c.n), 0);
  const out: Citation[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    n += 1;
    out.push({ n, kind: "web", url: source.url, documentId: null, name: source.title, page: null, heading: null, snippet: source.snippet, score: 1 });
  }
  return out;
}
