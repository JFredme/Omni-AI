"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { PROVIDER_INFO, SEARCH_PROVIDERS, type SearchProvider, type SearchSettingsDto } from "@/lib/research/types";

/** Where the web search provider for Research is chosen. The key is saved encrypted and is never shown again. */
export function SearchSettingsCard({ compact = false, onChange }: { compact?: boolean; onChange?: (settings: SearchSettingsDto) => void }) {
  const [settings, setSettings] = useState<SearchSettingsDto | null>(null);
  const [provider, setProvider] = useState<SearchProvider | "">("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const adopt = useCallback(
    (next: SearchSettingsDto) => {
      setSettings(next);
      setProvider(next.provider ?? "");
      setBaseUrl(next.baseUrl ?? "");
      onChange?.(next);
    },
    [onChange],
  );

  useEffect(() => {
    apiRequest<{ settings: SearchSettingsDto }>("/api/research/settings")
      .then((data) => adopt(data.settings))
      .catch((caught) => setError(caught instanceof ClientApiError ? caught.message : "Couldn't load the search settings."));
  }, [adopt]);

  const info = provider ? PROVIDER_INFO[provider] : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { settings: next } = await apiRequest<{ settings: SearchSettingsDto }>("/api/research/settings", {
        method: "PUT",
        json: { provider: provider || null, ...(apiKey ? { apiKey } : {}), baseUrl: info?.needsUrl ? baseUrl : null },
      });
      setApiKey("");
      adopt(next);
      setMessage("Saved.");
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ results: number }>("/api/research/settings/test", { method: "POST", json: {} });
      setMessage(result.results > 0 ? "Connected: the search service answered with results." : "Connected, but the search returned no results for the test query.");
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "The test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    setBusy(true);
    setError(null);
    try {
      const { settings: next } = await apiRequest<{ settings: SearchSettingsDto }>("/api/research/settings", { method: "PUT", json: { provider: provider || null, apiKey: "" } });
      adopt(next);
      setMessage("Key removed.");
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't remove the key.");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <form onSubmit={save} className="space-y-4">
      <div>
        <h2 className="font-semibold">Web search</h2>
        <p className="mt-1 text-sm text-muted-foreground">Research needs a search service to find real pages. Omni never makes up sources: everything it cites comes from what this service returns.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {message ? (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      ) : null}
      <Field label="Provider" htmlFor="search-provider" hint={info?.help}>
        <Select id="search-provider" value={provider} onChange={(e) => setProvider(e.target.value as SearchProvider | "")}>
          <option value="">Not set up</option>
          {SEARCH_PROVIDERS.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_INFO[id].label}
            </option>
          ))}
        </Select>
      </Field>
      {info?.needsKey ? (
        <Field label="API key" htmlFor="search-key" hint={settings?.keyConfigured ? `A key ending in ${settings.keyLast4} is saved. Paste a new one to replace it.` : "Saved encrypted, and never shown again."}>
          <Input id="search-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings?.keyConfigured ? "••••••••" : ""} />
        </Field>
      ) : null}
      {info?.needsUrl ? (
        <Field label="Address of your instance" htmlFor="search-url">
          <Input id="search-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:8080" />
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="outline" disabled={busy || !settings?.ready} onClick={() => void test()}>
          Test search
        </Button>
        {settings?.keyConfigured ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void removeKey()}>
            Remove key
          </Button>
        ) : null}
      </div>
    </form>
  );
  return compact ? <div className="rounded-lg border border-border p-5">{body}</div> : <Card className="lg:col-span-2">{body}</Card>;
}
