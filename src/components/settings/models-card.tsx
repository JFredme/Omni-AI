"use client";

import { useState } from "react";
import { RefreshCw, Star, X } from "lucide-react";
import { ModelPicker } from "@/components/model-picker";
import { describeError } from "@/components/chat/use-model-catalog";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatRelativeDate } from "@/lib/format";
import type { CatalogModel } from "@/lib/openrouter/models";
import type { SettingsView } from "@/lib/settings";

export function ModelsCard({
  settings,
  models,
  fetchedAt,
  loading,
  error,
  onRefresh,
  onSetDefault,
  onToggleFavorite,
}: {
  settings: SettingsView;
  models: CatalogModel[];
  fetchedAt: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSetDefault: (modelId: string | null) => Promise<unknown>;
  onToggleFavorite: (modelId: string) => Promise<unknown>;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const defaultModel = models.find((model) => model.id === settings.defaultModelId) ?? null;
  const favorites = settings.favoriteModelIds.map((id) => ({
    id,
    name: models.find((model) => model.id === id)?.name ?? id,
  }));
  const freeCount = models.filter((model) => model.isFree).length;

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Models</h2>
        <p className="text-sm text-muted-foreground">
          The catalog comes from OpenRouter and is cached for 15 minutes. Set a default model for new conversations and
          star the ones you use most.
        </p>
      </div>

      {!settings.apiKey.configured ? (
        <p className="text-sm text-muted-foreground">Save an API key to load the model list.</p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">Default model</p>
            <div className="flex flex-wrap items-center gap-2">
              <ModelPicker
                models={models}
                value={settings.defaultModelId}
                favoriteIds={settings.favoriteModelIds}
                onSelect={(modelId) => void run(() => onSetDefault(modelId))}
                onToggleFavorite={(modelId) => void run(() => onToggleFavorite(modelId))}
                loading={loading}
                loadError={error}
              />
              {settings.defaultModelId ? (
                <button
                  type="button"
                  onClick={() => void run(() => onSetDefault(null))}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Clear default
                </button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {defaultModel
                ? `${defaultModel.name} · ${defaultModel.id}`
                : settings.defaultModelId
                  ? `${settings.defaultModelId} (not in the current catalog)`
                  : "No default. New conversations will ask you to pick a model."}
            </p>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Star className="size-3.5 text-warning" aria-hidden />
              Favorites
            </p>
            {favorites.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Open the model picker and click the star beside a model to pin it here.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {favorites.map((favorite) => (
                  <li
                    key={favorite.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-xs"
                  >
                    <span className="truncate">{favorite.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${favorite.name} from favorites`}
                      onClick={() => void run(() => onToggleFavorite(favorite.id))}
                      className="rounded-full p-0.5 text-muted-foreground hover:text-danger"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
            <p className="text-muted-foreground">
              {models.length > 0
                ? `${models.length.toLocaleString()} text models · ${freeCount} free${
                    fetchedAt ? ` · updated ${formatRelativeDate(fetchedAt)}` : ""
                  }`
                : "No models loaded."}
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden />
              Refresh catalog
            </button>
          </div>
        </>
      )}

      {actionError ? (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      ) : null}
    </Card>
  );
}
