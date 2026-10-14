import type { SearchProvider } from "./types";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchConfig {
  provider: SearchProvider;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export type SearchErrorKind = "key_rejected" | "rate_limited" | "unavailable" | "bad_response";

export class SearchError extends Error {
  constructor(
    message: string,
    readonly kind: SearchErrorKind,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

/** Removes tracking parameters and fragments so the same page isn't counted twice. */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|ref_)/i.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const text = url.toString();
    return url.pathname === "/" && !url.search ? text.replace(/\/$/, "") : text;
  } catch {
    return null;
  }
}

export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = normalizeUrl(hit.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...hit, url: key });
  }
  return out;
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

function toHits(items: unknown, fields: { title: string; url: string; snippet: string }): SearchHit[] {
  if (!Array.isArray(items)) throw new SearchError("The search service returned something unexpected.", "bad_response");
  return items
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { title: clean(record[fields.title], 200), url: typeof record[fields.url] === "string" ? (record[fields.url] as string) : "", snippet: clean(record[fields.snippet], 500) };
    })
    .filter((hit) => hit.title && normalizeUrl(hit.url));
}

async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SearchError(timeout.aborted ? "The search service took too long to answer." : "The search service couldn't be reached.", "unavailable");
  }
  if (response.status === 401 || response.status === 403) throw new SearchError("The search service rejected the API key.", "key_rejected");
  if (response.status === 429) throw new SearchError("The search service says you're searching too often. Try again in a moment.", "rate_limited");
  if (!response.ok) throw new SearchError(`The search service answered with HTTP ${response.status}.`, "unavailable");
  try {
    return await response.json();
  } catch {
    throw new SearchError("The search service returned something that isn't JSON.", "bad_response");
  }
}

/** Runs one web search with the chosen provider. Results are exactly what the provider returned, never invented. */
export async function webSearch(config: SearchConfig, query: string, options: { count?: number; signal?: AbortSignal } = {}): Promise<SearchHit[]> {
  const count = Math.min(10, Math.max(1, options.count ?? 6));
  if (config.provider === "brave") {
    const base = (process.env.BRAVE_SEARCH_BASE_URL ?? "https://api.search.brave.com").replace(/\/+$/, "");
    const data = (await request(`${base}/res/v1/web/search?${new URLSearchParams({ q: query, count: String(count) })}`, { headers: { Accept: "application/json", "X-Subscription-Token": config.apiKey ?? "" } }, options.signal)) as { web?: { results?: unknown } };
    return toHits(data.web?.results ?? [], { title: "title", url: "url", snippet: "description" }).slice(0, count);
  }
  if (config.provider === "tavily") {
    const base = (process.env.TAVILY_BASE_URL ?? "https://api.tavily.com").replace(/\/+$/, "");
    const data = (await request(`${base}/search`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey ?? ""}` }, body: JSON.stringify({ query, max_results: count, search_depth: "basic" }) }, options.signal)) as { results?: unknown };
    return toHits(data.results ?? [], { title: "title", url: "url", snippet: "content" }).slice(0, count);
  }
  const base = (config.baseUrl ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new SearchError("Set the address of your SearXNG instance in Settings.", "unavailable");
  const data = (await request(`${base}/search?${new URLSearchParams({ q: query, format: "json" })}`, { headers: { Accept: "application/json" } }, options.signal)) as { results?: unknown };
  return toHits(data.results ?? [], { title: "title", url: "url", snippet: "content" }).slice(0, count);
}
