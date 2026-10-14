"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiRequest } from "@/lib/client/api";
import { formatUsd } from "@/lib/format";
import type { SettingsView } from "@/lib/settings";
import { describeError } from "@/components/chat/use-model-catalog";
import type { KeyInfo } from "@/lib/openrouter/client";
import { cn } from "@/lib/utils";

type TestResult = { ok: true; info: KeyInfo } | { ok: false; message: string };

export function ApiKeyCard({
  settings,
  onSettingsChange,
}: {
  settings: SettingsView;
  onSettingsChange: (next: SettingsView) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { apiKey } = settings;
  const canSave = apiKey.canStoreKey && draft.trim().length > 0 && !saving;

  async function save() {
    setSaving(true);
    setMessage(null);
    setTestResult(null);
    try {
      const updated = await apiRequest<SettingsView>("/api/settings/api-key", {
        method: "PUT",
        json: { apiKey: draft.trim() },
      });
      setDraft("");
      onSettingsChange(updated);
      setMessage({ tone: "ok", text: "API key saved and encrypted. Test the connection to confirm it works." });
    } catch (error) {
      setMessage({ tone: "error", text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    try {
      const body = draft.trim() ? { apiKey: draft.trim() } : {};
      const result = await apiRequest<{ ok: true; info: KeyInfo }>("/api/settings/api-key/test", {
        method: "POST",
        json: body,
      });
      setTestResult({ ok: true, info: result.info });
    } catch (error) {
      setTestResult({ ok: false, message: describeError(error) });
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    setMessage(null);
    setTestResult(null);
    try {
      const updated = await apiRequest<SettingsView>("/api/settings/api-key", { method: "DELETE" });
      onSettingsChange(updated);
      setMessage({ tone: "ok", text: "The saved API key was removed." });
    } catch (error) {
      setMessage({ tone: "error", text: describeError(error) });
    }
  }

  return (
    <Card className="space-y-4 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4" aria-hidden />
            OpenRouter API key
          </h2>
          <p className="text-sm text-muted-foreground">
            Get a key at openrouter.ai/keys. It is encrypted with your server&apos;s ENCRYPTION_KEY before it is saved,
            and it is never sent to the browser after you enter it.
          </p>
        </div>
        <StatusPill configured={apiKey.configured} source={apiKey.source} last4={apiKey.last4} />
      </div>

      {!apiKey.canStoreKey && apiKey.source !== "environment" ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            Set <code className="font-mono">ENCRYPTION_KEY</code> in your <code className="font-mono">.env</code> file
            (at least 32 characters) to store a key from this page, or set{" "}
            <code className="font-mono">OPENROUTER_API_KEY</code> instead.
          </p>
        </div>
      ) : null}

      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save();
        }}
      >
        <label className="sr-only" htmlFor="openrouter-key">
          OpenRouter API key
        </label>
        <input
          id="openrouter-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          disabled={!apiKey.canStoreKey}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={apiKey.configured ? "Enter a new key to replace the saved one" : "sk-or-v1-…"}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-ring disabled:opacity-50"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!canSave} className={buttonVariants({ variant: "primary" })}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save key
          </button>
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing || (!apiKey.configured && !draft.trim())}
            className={buttonVariants({ variant: "outline" })}
          >
            {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
            Test connection
          </button>
          {apiKey.source === "settings" ? (
            <button type="button" onClick={() => void remove()} className={buttonVariants({ variant: "ghost" })}>
              Remove saved key
            </button>
          ) : null}
        </div>
      </form>

      {message ? (
        <p role="status" className={cn("text-sm", message.tone === "ok" ? "text-success" : "text-danger")}>
          {message.text}
        </p>
      ) : null}

      {testResult ? <TestResultPanel result={testResult} /> : null}

      <p className="text-xs text-muted-foreground">
        {apiKey.source === "environment"
          ? "The key is read from OPENROUTER_API_KEY in the server environment."
          : "Keys saved here are stored encrypted in the local database."}
        {apiKey.updatedAt ? ` Last saved ${new Date(apiKey.updatedAt).toLocaleString()}.` : ""}
      </p>
    </Card>
  );
}

function StatusPill({
  configured,
  source,
  last4,
}: {
  configured: boolean;
  source: SettingsView["apiKey"]["source"];
  last4: string | null;
}) {
  if (!configured) {
    return <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Not configured</span>;
  }
  return (
    <span className="whitespace-nowrap rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
      {source === "environment" ? "From environment" : "Saved"}
      {last4 ? ` · …${last4}` : ""}
    </span>
  );
}

function TestResultPanel({ result }: { result: TestResult }) {
  if (!result.ok) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{result.message}</span>
      </div>
    );
  }
  const { info } = result;
  return (
    <div className="grid gap-3 rounded-lg border border-success/40 bg-success/5 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div className="col-span-full flex items-center gap-2 font-medium text-success">
        <CheckCircle2 className="size-4" aria-hidden />
        Connected to OpenRouter
      </div>
      <Stat label="Key" value={info.label} mono />
      <Stat label="Account type" value={info.isFreeTier ? "Free tier" : "Paid"} />
      <Stat label="Used (all time)" value={formatUsd(info.usage)} />
      <Stat
        label="Key limit left"
        value={info.limit === null ? "No limit" : `${formatUsd(info.limitRemaining)} of ${formatUsd(info.limit)}`}
      />
    </div>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("truncate font-medium", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
