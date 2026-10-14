"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Braces, ChevronDown, Image as ImageIcon, Search, Star, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatContext, formatPricePerMillion } from "@/lib/format";
import type { CatalogModel } from "@/lib/openrouter/models";

type Filter = "all" | "free" | "paid" | "favorites" | "tools" | "json" | "images" | "reasoning";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
  { value: "favorites", label: "Favorites" },
  { value: "tools", label: "Tools" },
  { value: "json", label: "JSON" },
  { value: "images", label: "Images" },
  { value: "reasoning", label: "Reasoning" },
];

const MAX_RENDERED = 150;

export function matchesFilter(model: CatalogModel, filter: Filter, favoriteIds: string[]): boolean {
  switch (filter) {
    case "all":
      return true;
    case "free":
      return model.isFree;
    case "paid":
      return !model.isFree;
    case "favorites":
      return favoriteIds.includes(model.id);
    case "tools":
      return model.capabilities.tools;
    case "json":
      return model.capabilities.jsonOutput;
    case "images":
      return model.capabilities.imageInput;
    case "reasoning":
      return model.capabilities.reasoning;
  }
}

export function matchesQuery(model: CatalogModel, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${model.name} ${model.id} ${model.description}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function ModelPicker({
  models,
  value,
  favoriteIds,
  onSelect,
  onToggleFavorite,
  disabled = false,
  loadError = null,
  loading = false,
  align = "left",
}: {
  models: CatalogModel[];
  value: string | null;
  favoriteIds: string[];
  onSelect: (modelId: string) => void;
  onToggleFavorite: (modelId: string) => void;
  disabled?: boolean;
  loadError?: string | null;
  loading?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = models.find((model) => model.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filtered = useMemo(
    () =>
      models
        .filter((model) => matchesFilter(model, filter, favoriteIds) && matchesQuery(model, query))
        .sort((a, b) => {
          const favA = favoriteIds.includes(a.id) ? 0 : 1;
          const favB = favoriteIds.includes(b.id) ? 0 : 1;
          return favA - favB;
        }),
    [models, filter, favoriteIds, query],
  );
  const visible = filtered.slice(0, MAX_RENDERED);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate font-medium">
          {selected ? selected.name : loading ? "Loading models…" : value ?? "Choose a model"}
        </span>
        {selected?.isFree ? (
          <span className="rounded bg-success/15 px-1.5 text-[10px] font-medium uppercase text-success">Free</span>
        ) : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a model"
          className={cn(
            "absolute z-40 mt-2 flex max-h-[70vh] w-[min(92vw,30rem)] flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl animate-pop-in",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
              <Search className="size-4 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models by name or id"
                aria-label="Search models"
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter models">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    filter === item.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {loadError ? (
            <p className="p-4 text-sm text-danger">{loadError}</p>
          ) : models.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{loading ? "Loading the model list…" : "No models loaded yet."}</p>
          ) : (
            <ul role="listbox" aria-label="Models" className="flex-1 overflow-y-auto p-1.5">
              {visible.map((model) => {
                const isFavorite = favoriteIds.includes(model.id);
                const isSelected = model.id === value;
                return (
                  <li
                    key={model.id}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-accent/60",
                      isSelected && "bg-accent",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={isFavorite ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`}
                      aria-pressed={isFavorite}
                      onClick={() => onToggleFavorite(model.id)}
                      className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-warning"
                    >
                      <Star className={cn("size-4", isFavorite && "fill-warning text-warning")} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(model.id);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{model.name}</span>
                        {model.isFree ? (
                          <span className="rounded bg-success/15 px-1.5 text-[10px] font-medium uppercase text-success">Free</span>
                        ) : null}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{model.id}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{formatContext(model.contextLength)}</span>
                        <span>
                          {formatPricePerMillion(model.promptPrice)} in · {formatPricePerMillion(model.completionPrice)} out
                        </span>
                        <Capabilities model={model} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            {filtered.length} model{filtered.length === 1 ? "" : "s"}
            {filtered.length > MAX_RENDERED ? ` · showing first ${MAX_RENDERED}, refine your search to see more` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Capabilities({ model }: { model: CatalogModel }) {
  const items = [
    { on: model.capabilities.tools, label: "Tool calling", Icon: Wrench },
    { on: model.capabilities.jsonOutput, label: "Structured JSON output", Icon: Braces },
    { on: model.capabilities.imageInput, label: "Image input", Icon: ImageIcon },
    { on: model.capabilities.reasoning, label: "Reasoning", Icon: Brain },
  ].filter((item) => item.on);

  return (
    <span className="inline-flex items-center gap-1.5">
      {items.map(({ label, Icon }) => (
        <span key={label} title={label} aria-label={label}>
          <Icon className="size-3" aria-hidden />
        </span>
      ))}
    </span>
  );
}
