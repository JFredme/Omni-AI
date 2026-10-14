import { getOpenRouterBaseUrl } from "@/lib/env";
import { fetchModelCatalog } from "./client";
import type { CatalogModel } from "./models";

export const CATALOG_TTL_MS = 15 * 60 * 1000;

interface CatalogSnapshot {
  models: CatalogModel[];
  fetchedAt: number;
}

const snapshots = new Map<string, CatalogSnapshot>();
const inFlight = new Map<string, Promise<CatalogSnapshot>>();

export interface CatalogResult {
  models: CatalogModel[];
  fetchedAt: number;
  cached: boolean;
}

export async function getModelCatalog(options: {
  apiKey?: string | null;
  refresh?: boolean;
  now?: number;
} = {}): Promise<CatalogResult> {
  const cacheKey = getOpenRouterBaseUrl();
  const now = options.now ?? Date.now();
  const existing = snapshots.get(cacheKey);

  if (!options.refresh && existing && now - existing.fetchedAt < CATALOG_TTL_MS) {
    return { models: existing.models, fetchedAt: existing.fetchedAt, cached: true };
  }

  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = fetchModelCatalog({ apiKey: options.apiKey ?? null }).then((models) => {
      const snapshot = { models, fetchedAt: Date.now() };
      snapshots.set(cacheKey, snapshot);
      return snapshot;
    });
    inFlight.set(cacheKey, pending);
    pending.finally(() => inFlight.delete(cacheKey)).catch(() => undefined);
  }

  try {
    const snapshot = await pending;
    return { models: snapshot.models, fetchedAt: snapshot.fetchedAt, cached: false };
  } catch (error) {
    if (existing) {
      return { models: existing.models, fetchedAt: existing.fetchedAt, cached: true };
    }
    throw error;
  }
}

export async function findCatalogModel(modelId: string, apiKey: string | null): Promise<CatalogModel | null> {
  const { models } = await getModelCatalog({ apiKey });
  return models.find((model) => model.id === modelId) ?? null;
}

export function clearCatalogCache() {
  snapshots.clear();
  inFlight.clear();
}
