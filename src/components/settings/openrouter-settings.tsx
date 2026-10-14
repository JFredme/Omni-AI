"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiKeyCard } from "@/components/settings/api-key-card";
import { ModelsCard } from "@/components/settings/models-card";
import { BudgetCard, UsageCard } from "@/components/settings/usage-card";
import { describeError, useModelCatalog } from "@/components/chat/use-model-catalog";
import { Card } from "@/components/ui/card";
import { apiRequest } from "@/lib/client/api";
import type { SettingsView } from "@/lib/settings";
import type { UsageSummary } from "@/lib/usage";

export function OpenRouterSettings() {
  const catalog = useModelCatalog();
  const { settings, setSettings, loadModels, updateSettings } = catalog;
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await apiRequest<UsageSummary>("/api/usage"));
      setUsageError(null);
    } catch (error) {
      setUsageError(describeError(error));
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<UsageSummary>("/api/usage")
      .then((data) => {
        if (active) setUsage(data);
      })
      .catch((error: unknown) => {
        if (active) setUsageError(describeError(error));
      });
    return () => {
      active = false;
    };
  }, []);

  if (!settings) {
    return (
      <Card className="lg:col-span-2">
        <p className="text-sm text-muted-foreground">
          {catalog.settingsError ?? "Loading OpenRouter settings…"}
        </p>
      </Card>
    );
  }

  function handleKeyChange(next: SettingsView) {
    setSettings(next);
    if (next.apiKey.configured) {
      void loadModels(true);
    }
    void loadUsage();
  }

  return (
    <>
      <ApiKeyCard settings={settings} onSettingsChange={handleKeyChange} />
      <ModelsCard
        settings={settings}
        models={catalog.models}
        fetchedAt={catalog.fetchedAt}
        loading={catalog.modelsLoading}
        error={catalog.modelsError}
        onRefresh={() => void loadModels(true)}
        onSetDefault={(modelId) => updateSettings({ defaultModelId: modelId })}
        onToggleFavorite={(modelId) => catalog.toggleFavorite(modelId)}
      />
      <BudgetCard
        settings={settings}
        usage={usage}
        onSaveBudget={async (value) => {
          await updateSettings({ monthlyBudgetUsd: value });
          await loadUsage();
        }}
      />
      {usageError ? (
        <Card className="lg:col-span-2">
          <p className="text-sm text-danger">{usageError}</p>
        </Card>
      ) : (
        <UsageCard usage={usage} />
      )}
    </>
  );
}
