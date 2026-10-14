"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, isAbortError } from "@/lib/client/api";
import type { CatalogModel } from "@/lib/openrouter/models";
import type { SettingsView } from "@/lib/settings";

export function describeError(error: unknown): string {
  if (isAbortError(error)) return "The request was cancelled.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

async function fetchCatalog(refresh: boolean) {
  return apiRequest<{ models: CatalogModel[]; fetchedAt: string }>(`/api/models${refresh ? "?refresh=1" : ""}`);
}

/** Shared settings + model catalog state used by the chat and settings screens. */
export function useModelCatalog() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<SettingsView>("/api/settings")
      .then(async (data) => {
        if (!active) return;
        setSettings(data);
        if (!data.apiKey.configured) return;
        setModelsLoading(true);
        try {
          const catalog = await fetchCatalog(false);
          if (active) {
            setModels(catalog.models);
            setFetchedAt(catalog.fetchedAt);
          }
        } catch (error) {
          if (active) setModelsError(describeError(error));
        } finally {
          if (active) setModelsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (active) setSettingsError(describeError(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const loadModels = useCallback(async (refresh = false) => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const catalog = await fetchCatalog(refresh);
      setModels(catalog.models);
      setFetchedAt(catalog.fetchedAt);
    } catch (error) {
      setModelsError(describeError(error));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const updateSettings = useCallback(
    async (patch: { defaultModelId?: string | null; favoriteModelIds?: string[]; monthlyBudgetUsd?: number | null }) => {
      const previous = settings;
      if (previous) {
        setSettings({
          ...previous,
          ...(patch.defaultModelId !== undefined ? { defaultModelId: patch.defaultModelId } : {}),
          ...(patch.favoriteModelIds !== undefined ? { favoriteModelIds: patch.favoriteModelIds } : {}),
          ...(patch.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: patch.monthlyBudgetUsd } : {}),
        });
      }
      try {
        const updated = await apiRequest<SettingsView>("/api/settings", { method: "PATCH", json: patch });
        setSettings(updated);
        return updated;
      } catch (error) {
        setSettings(previous);
        throw error;
      }
    },
    [settings],
  );

  const toggleFavorite = useCallback(
    async (modelId: string) => {
      const current = settings?.favoriteModelIds ?? [];
      const next = current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId];
      return updateSettings({ favoriteModelIds: next });
    },
    [settings, updateSettings],
  );

  return {
    settings,
    setSettings,
    settingsError,
    models,
    fetchedAt,
    modelsLoading,
    modelsError,
    loadModels,
    updateSettings,
    toggleFavorite,
  };
}
