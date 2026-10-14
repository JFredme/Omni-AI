export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1_000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 100_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(2)}`;
}

/** OpenRouter publishes prices per token; the UI shows them per million tokens. */
export function formatPricePerMillion(perToken: number | null): string {
  if (perToken === null) return "Price n/a";
  if (perToken === 0) return "Free";
  const perMillion = perToken * 1_000_000;
  return `$${perMillion < 1 ? perMillion.toFixed(3) : perMillion.toFixed(2)}/M`;
}

export function formatContext(tokens: number | null): string {
  if (tokens === null) return "Context n/a";
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M ctx`
    : `${Math.round(tokens / 1000)}K ctx`;
}

export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffMinutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
