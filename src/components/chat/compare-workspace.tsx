"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Plus, Square, X } from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { describeError, useModelCatalog } from "@/components/chat/use-model-catalog";
import { ModelPicker } from "@/components/model-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { isAbortError, streamEvents } from "@/lib/client/api";
import { formatContext, formatTokens, formatUsd } from "@/lib/format";
import type { CompareEvent } from "@/lib/chat/compare";
import type { CatalogModel } from "@/lib/openrouter/models";
import { cn } from "@/lib/utils";

interface Column {
  text: string;
  state: "idle" | "streaming" | "done" | "error";
  error?: string;
  ms?: number;
  tokens?: { promptTokens: number; completionTokens: number } | null;
  costUsd?: number | null;
}

const MAX_MODELS = 4;

function capabilityLine(model: CatalogModel | undefined): string {
  if (!model) return "";
  const parts = [formatContext(model.contextLength), model.capabilities.imageInput ? "images" : null, model.capabilities.tools ? "tools" : null, model.capabilities.reasoning ? "reasoning" : null, model.isFree ? "free" : null];
  return parts.filter(Boolean).join(" · ");
}

export function CompareWorkspace() {
  const catalog = useModelCatalog();
  const { settings, models } = catalog;
  const [picked, setPicked] = useState<(string | null)[]>([null, null]);
  const [prompt, setPrompt] = useState("");
  const [columns, setColumns] = useState<Record<string, Column>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const chosen = picked.filter((id): id is string => Boolean(id));
  const unique = new Set(chosen).size === chosen.length;
  const ready = chosen.length >= 2 && unique && prompt.trim().length > 0 && !running;
  const byId = new Map(models.map((model) => [model.id, model]));

  async function run() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setColumns(Object.fromEntries(chosen.map((id) => [id, { text: "", state: "streaming" } as Column])));
    try {
      await streamEvents<CompareEvent>("/api/compare", { prompt, modelIds: chosen }, {
        signal: controller.signal,
        onEvent: (event) => {
          setColumns((prev) => {
            const current = prev[event.modelId];
            if (!current) return prev;
            if (event.type === "delta") return { ...prev, [event.modelId]: { ...current, text: current.text + event.text } };
            if (event.type === "done") return { ...prev, [event.modelId]: { ...current, state: "done", ms: event.ms, tokens: event.usage, costUsd: event.costUsd } };
            return { ...prev, [event.modelId]: { ...current, state: "error", error: event.message, ms: event.ms } };
          });
        },
      });
    } catch (caught) {
      if (!isAbortError(caught)) setError(describeError(caught));
    } finally {
      setColumns((prev) => Object.fromEntries(Object.entries(prev).map(([id, column]) => [id, column.state === "streaming" ? { ...column, state: "done" as const } : column])));
      abortRef.current = null;
      setRunning(false);
    }
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  const keyConfigured = settings?.apiKey.configured ?? false;

  return (
    <div className="space-y-6">
      <Link href="/chat" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> AI Chat
      </Link>
      <PageHeader eyebrow="AI Chat" title="Compare models" description="Send one prompt to up to four models and read their answers side by side. Each answer is billed like any other request; nothing is saved as a chat." />

      {settings && !keyConfigured ? (
        <p className="text-sm text-muted-foreground">
          Add your OpenRouter API key in <Link href="/settings" className="underline underline-offset-2">Settings</Link> to compare models.
        </p>
      ) : (
        <>
          <section aria-label="Models to compare" className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              {picked.map((id, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <ModelPicker
                      models={models}
                      value={id}
                      favoriteIds={settings?.favoriteModelIds ?? []}
                      onSelect={(modelId) => setPicked((prev) => prev.map((value, i) => (i === index ? modelId : value)))}
                      onToggleFavorite={(modelId) => void catalog.toggleFavorite(modelId).catch((caught: unknown) => setError(describeError(caught)))}
                      loading={catalog.modelsLoading}
                      loadError={catalog.modelsError}
                      disabled={running}
                    />
                    {picked.length > 2 ? (
                      <Button size="icon" variant="ghost" onClick={() => setPicked((prev) => prev.filter((_, i) => i !== index))} disabled={running} aria-label={`Remove model ${index + 1}`}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  <p className="px-1 text-xs text-muted-foreground">{id ? capabilityLine(byId.get(id)) : `Model ${index + 1}`}</p>
                </div>
              ))}
              {picked.length < MAX_MODELS ? (
                <Button variant="outline" onClick={() => setPicked((prev) => [...prev, null])} disabled={running}>
                  <Plus className="size-4" aria-hidden /> Add a model
                </Button>
              ) : null}
            </div>
            {chosen.length >= 2 && !unique ? <p role="alert" className="text-xs text-danger">Choose different models to compare.</p> : null}
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) void run();
            }}
            className="space-y-2"
          >
            <label htmlFor="compare-prompt" className="eyebrow block">
              Prompt
            </label>
            <Textarea id="compare-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} maxLength={20_000} placeholder="Ask the same thing of every model" />
            <div className="flex gap-2">
              {running ? (
                <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                  <Square className="size-3.5 fill-current" aria-hidden /> Stop
                </Button>
              ) : (
                <Button type="submit" variant="primary" disabled={!ready}>
                  Compare
                </Button>
              )}
              {chosen.length < 2 ? <p className="self-center text-xs text-muted-foreground">Choose at least two models.</p> : null}
            </div>
          </form>
        </>
      )}

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {Object.keys(columns).length > 0 ? (
        <section aria-label="Answers" className={cn("grid gap-4", chosen.length === 2 ? "lg:grid-cols-2" : chosen.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2 xl:grid-cols-4")}>
          {Object.entries(columns).map(([id, column]) => (
            <article key={id} aria-label={`Answer from ${byId.get(id)?.name ?? id}`} className="flex min-w-0 flex-col rounded-lg border border-border">
              <header className="border-b border-border px-4 py-2.5">
                <h2 className="truncate text-sm font-medium">{byId.get(id)?.name ?? id}</h2>
                <p className="truncate font-mono text-xs text-muted-foreground">{id}</p>
              </header>
              <div className="min-h-32 flex-1 px-4 py-3">
                {column.state === "error" ? (
                  <p role="alert" className="text-sm text-danger">{column.error}</p>
                ) : column.text ? (
                  <Markdown>{column.text}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">{column.state === "streaming" ? "Thinking…" : "No text."}</p>
                )}
              </div>
              <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
                {column.state === "streaming" ? <span>Generating…</span> : null}
                {column.ms !== undefined ? <span className="num">{(column.ms / 1000).toFixed(1)}s</span> : null}
                {column.tokens ? <span className="num">{formatTokens(column.tokens.promptTokens)} in · {formatTokens(column.tokens.completionTokens)} out</span> : null}
                {column.state === "done" ? <span className="num">{column.costUsd === null || column.costUsd === undefined ? "cost unknown" : formatUsd(column.costUsd)}</span> : null}
                {column.text ? (
                  <button type="button" onClick={() => void copy(id, column.text)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
                    {copied === id ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copied === id ? "Copied" : "Copy"}
                  </button>
                ) : null}
              </footer>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
