// Client-safe research types.

export const SEARCH_PROVIDERS = ["brave", "tavily", "searxng"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export const PROVIDER_INFO: Record<SearchProvider, { label: string; needsKey: boolean; needsUrl: boolean; help: string }> = {
  brave: { label: "Brave Search", needsKey: true, needsUrl: false, help: "Create an API key at brave.com/search/api (it has a free plan)." },
  tavily: { label: "Tavily", needsKey: true, needsUrl: false, help: "Create an API key at tavily.com (it has a free plan)." },
  searxng: { label: "SearXNG (self-hosted)", needsKey: false, needsUrl: true, help: "Point this at your own SearXNG instance. It must allow the JSON format." },
};

export const DEPTHS = ["quick", "thorough"] as const;
export type Depth = (typeof DEPTHS)[number];
export const DEPTH_SETTINGS: Record<Depth, { queries: number; sources: number; label: string }> = {
  quick: { queries: 3, sources: 4, label: "Quick (up to 4 sources)" },
  thorough: { queries: 5, sources: 8, label: "Thorough (up to 8 sources)" },
};

export interface SearchSettingsDto {
  provider: SearchProvider | null;
  keyConfigured: boolean;
  keyLast4: string | null;
  baseUrl: string | null;
  /** True when research can run: a provider is chosen and has what it needs. */
  ready: boolean;
}

export interface SourceDto {
  n: number;
  title: string;
  url: string;
  snippet: string;
  /** Whether the page itself was read. If not, the report could only rely on the search snippet. */
  read: boolean;
  note?: string;
  /** Whether the report actually cites this source. */
  cited: boolean;
}

export type ReportStatus = "running" | "complete" | "failed" | "stopped";

export interface ReportDto {
  id: string;
  question: string;
  depth: Depth;
  status: ReportStatus;
  report: string;
  sources: SourceDto[];
  queries: string[];
  modelId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ResearchEvent =
  | { type: "start"; reportId: string }
  | { type: "status"; message: string }
  | { type: "queries"; queries: string[] }
  | { type: "sources"; sources: SourceDto[] }
  | { type: "delta"; text: string }
  | { type: "done"; report: ReportDto }
  | { type: "error"; message: string; report: ReportDto | null };
