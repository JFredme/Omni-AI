"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { describeError } from "@/components/chat/use-model-catalog";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatTokens, formatUsd } from "@/lib/format";
import type { SettingsView } from "@/lib/settings";
import type { UsageSummary } from "@/lib/usage";
import { cn } from "@/lib/utils";

export function BudgetCard({
  settings,
  usage,
  onSaveBudget,
}: {
  settings: SettingsView;
  usage: UsageSummary | null;
  onSaveBudget: (value: number | null) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(settings.monthlyBudgetUsd?.toString() ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const budget = settings.monthlyBudgetUsd;
  const spend = usage?.month.spendUsd ?? 0;
  const percent = budget && budget > 0 ? Math.min(100, (spend / budget) * 100) : 0;
  const exceeded = budget !== null && spend >= budget;

  async function save(value: number | null) {
    setSaving(true);
    setMessage(null);
    try {
      await onSaveBudget(value);
      setMessage({ tone: "ok", text: value === null ? "Spending limit removed." : "Spending limit saved." });
    } catch (error) {
      setMessage({ tone: "error", text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      void save(null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      setMessage({ tone: "error", text: "Enter a positive dollar amount, or leave it empty for no limit." });
      return;
    }
    void save(Math.round(value * 100) / 100);
  }

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wallet className="size-4" aria-hidden />
          Monthly spending limit
        </h2>
        <p className="text-sm text-muted-foreground">
          New messages are blocked once this month&apos;s recorded spend reaches the limit. It applies only to this app,
          not to your OpenRouter account.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{formatUsd(spend)} this month</span>
          <span className="text-muted-foreground">{budget === null ? "No limit" : `of ${formatUsd(budget)}`}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Spending against monthly limit"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn("h-full rounded-full transition-all", exceeded ? "bg-danger" : "bg-primary")}
            style={{ width: `${percent}%` }}
          />
        </div>
        {exceeded ? <p className="text-sm text-danger">The monthly limit has been reached. Raise it to keep chatting.</p> : null}
        {usage && usage.month.unknownCostRequests > 0 ? (
          <p className="text-xs text-muted-foreground">
            {usage.month.unknownCostRequests} request(s) this month have no cost data and are not counted.
          </p>
        ) : null}
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="monthly-budget" className="text-sm text-muted-foreground">
          USD per month
        </label>
        <input
          id="monthly-budget"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="No limit"
          className="h-9 w-32 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
        />
        <button type="submit" disabled={saving} className={buttonVariants({ variant: "primary", size: "sm" })}>
          Save limit
        </button>
        {budget !== null ? (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              void save(null);
            }}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Remove limit
          </button>
        ) : null}
      </form>
      {message ? (
        <p role="status" className={cn("text-sm", message.tone === "ok" ? "text-success" : "text-danger")}>
          {message.text}
        </p>
      ) : null}
    </Card>
  );
}

export function UsageCard({ usage }: { usage: UsageSummary | null }) {
  if (!usage) {
    return (
      <Card className="space-y-2 lg:col-span-2">
        <h2 className="font-semibold">AI usage</h2>
        <p className="text-sm text-muted-foreground">Loading usage…</p>
      </Card>
    );
  }

  const { totals } = usage;
  const maxDaily = Math.max(1, ...usage.daily.map((day) => day.totalTokens));

  return (
    <Card className="space-y-5 lg:col-span-2">
      <div className="space-y-1">
        <h2 className="font-semibold">AI usage · last {usage.windowDays} days</h2>
        <p className="text-sm text-muted-foreground">
          Token counts come from OpenRouter. Costs are the amounts OpenRouter reports, or estimates from published model
          prices when OpenRouter does not report one (marked &ldquo;est.&rdquo; in chat).
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Requests" value={totals.requests.toLocaleString()} hint={`${totals.failedRequests} failed`} />
        <Metric
          label="Tokens"
          value={formatTokens(totals.totalTokens)}
          hint={`${formatTokens(totals.promptTokens)} in · ${formatTokens(totals.completionTokens)} out`}
        />
        <Metric
          label="Cost"
          value={formatUsd(totals.costUsd)}
          hint={totals.unknownCostRequests > 0 ? `${totals.unknownCostRequests} without cost data` : "All requests priced"}
        />
        <Metric label="Failed" value={totals.failedRequests.toLocaleString()} hint="Upstream errors" />
      </dl>

      <div className="space-y-2">
        <p className="text-sm font-medium">Tokens per day</p>
        <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={`Tokens per day over ${usage.windowDays} days`}>
          {usage.daily.map((day) => (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col justify-end" title={`${day.date}: ${formatTokens(day.totalTokens)} tokens, ${formatUsd(day.costUsd)}`}>
              <div
                className={cn("w-full rounded-t-sm", day.totalTokens > 0 ? "bg-primary/80" : "bg-muted")}
                style={{ height: `${Math.max(day.totalTokens > 0 ? 6 : 2, (day.totalTokens / maxDaily) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{usage.daily[0]?.date}</span>
          <span>{usage.daily.at(-1)?.date}</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">By model</p>
        {usage.byModel.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet. Usage appears here after your first message.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Model</th>
                  <th className="py-1.5 text-right font-medium">Requests</th>
                  <th className="py-1.5 text-right font-medium">Tokens</th>
                  <th className="py-1.5 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.byModel.slice(0, 10).map((model) => (
                  <tr key={model.modelId} className="border-t border-border">
                    <td className="max-w-[16rem] truncate py-2 font-mono text-xs">{model.modelId}</td>
                    <td className="py-2 text-right tabular-nums">{model.requests}</td>
                    <td className="py-2 text-right tabular-nums">{formatTokens(model.totalTokens)}</td>
                    <td className="py-2 text-right tabular-nums">{formatUsd(model.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}
