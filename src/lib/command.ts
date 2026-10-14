export interface CommandEntry {
  id: string;
  label: string;
  group: string;
  keywords?: string;
}

/** Returns the entries whose label, group, or keywords contain every word in the query. */
export function filterCommands<T extends CommandEntry>(entries: T[], query: string): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return entries;
  }
  return entries.filter((entry) => {
    const haystack = `${entry.label} ${entry.group} ${entry.keywords ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
