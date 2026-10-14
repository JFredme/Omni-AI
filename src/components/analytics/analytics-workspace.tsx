"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart } from "@/components/analytics/bar-chart";
import { PageHeader } from "@/components/page-header";
import { ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest } from "@/lib/client/api";
import { formatTokens, formatUsd } from "@/lib/format";
import { RANGES, type AnalyticsDto } from "@/lib/analytics/types";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-l border-border pl-4 first:border-l-0 first:pl-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-1 font-display text-3xl">{value}</dd>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-5">
      <h2 className="font-display text-xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const hours = (value: number) => `${value}h`;

export function AnalyticsWorkspace() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: number) => {
    setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await apiRequest<{ analytics: AnalyticsDto }>(`/api/analytics?days=${range}&tz=${encodeURIComponent(tz)}`);
      setData(result.analytics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when the range changes
    void load(days);
  }, [days, load]);

  const range = (
    <div role="group" aria-label="Date range" className="inline-flex rounded-md border border-border p-0.5">
      {RANGES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={days === value}
          onClick={() => setDays(value)}
          className={`rounded px-3 py-1 text-sm ${days === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {value} days
        </button>
      ))}
    </div>
  );

  const a = data;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Analytics" title="Analytics" description="What you got done, where your time went, and what the AI cost. Counted from your own data, nothing estimated." actions={range} />
      {error ? <ErrorBanner message={error} onRetry={() => void load(days)} /> : null}
      {!a && !error ? <SkeletonRows count={5} /> : null}
      {a ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
            <Stat label="Finished" value={String(a.tasks.totals.completed)} note={`${a.tasks.totals.created} created`} />
            <Stat label="Open now" value={String(a.tasks.totals.open)} note={`${a.tasks.totals.overdue} overdue`} />
            <Stat label="Median to finish" value={a.tasks.medianDaysToComplete === null ? "—" : `${a.tasks.medianDaysToComplete}d`} note={a.tasks.completedPerCreated === null ? "nothing created yet" : `${a.tasks.completedPerCreated}% of created`} />
            <Stat label="AI spend" value={formatUsd(a.ai.totals.costUsd)} note={`${a.ai.totals.requests} requests`} />
          </dl>

          <Section title="Tasks">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="eyebrow mb-2">Finished per day</h3>
                <BarChart title="Tasks finished per day" points={a.tasks.completed} />
              </div>
              <div>
                <h3 className="eyebrow mb-2">Created per day</h3>
                <BarChart title="Tasks created per day" points={a.tasks.created} tone="muted" />
              </div>
            </div>
            <div className="mt-6 grid items-start gap-6 md:grid-cols-2">
              <table className="w-full text-left text-sm">
                <caption className="eyebrow mb-2 text-left">By priority</caption>
                <thead><tr className="text-muted-foreground"><th className="py-1 font-medium">Priority</th><th className="py-1 text-right font-medium">Open</th><th className="py-1 text-right font-medium">Finished</th></tr></thead>
                <tbody>{a.tasks.byPriority.map((row) => (<tr key={row.priority} className="border-t border-border/60"><td className="py-1.5 capitalize">{row.priority}</td><td className="num py-1.5 text-right">{row.open}</td><td className="num py-1.5 text-right">{row.completed}</td></tr>))}</tbody>
              </table>
              <table className="w-full text-left text-sm">
                <caption className="eyebrow mb-2 text-left">By project</caption>
                <thead><tr className="text-muted-foreground"><th className="py-1 font-medium">Project</th><th className="py-1 text-right font-medium">Open</th><th className="py-1 text-right font-medium">Finished</th></tr></thead>
                <tbody>
                  {a.tasks.byProject.length === 0 ? <tr><td colSpan={3} className="border-t border-border/60 py-2 text-muted-foreground">No project work in this range.</td></tr> : null}
                  {a.tasks.byProject.map((row) => (<tr key={row.name} className="border-t border-border/60"><td className="py-1.5">{row.name}</td><td className="num py-1.5 text-right">{row.open}</td><td className="num py-1.5 text-right">{row.completed}</td></tr>))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Time">
            <p className="mb-4 text-sm text-muted-foreground">
              <span className="num">{a.time.totalScheduledHours}</span> hours on the calendar, <span className="num">{a.time.totalFocusHours}</span> of them set aside for tasks. All-day events aren&rsquo;t counted.
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <div><h3 className="eyebrow mb-2">Scheduled hours</h3><BarChart title="Scheduled hours per day" points={a.time.scheduledHoursByDay} format={hours} tone="muted" /></div>
              <div><h3 className="eyebrow mb-2">Focus hours</h3><BarChart title="Focus hours per day" points={a.time.focusHoursByDay} format={hours} /></div>
            </div>
          </Section>

          <Section title="AI usage">
            <p className="mb-4 text-sm text-muted-foreground">
              <span className="num">{formatTokens(a.ai.totals.totalTokens)}</span> tokens, <span className="num">{a.ai.totals.failedRequests}</span> failed requests.
              {a.ai.totals.unknownCostRequests > 0 ? ` ${a.ai.totals.unknownCostRequests} had no reported cost, so the total may be low.` : ""} This month: <span className="num">{formatUsd(a.ai.month.spendUsd)}</span>
              {a.ai.month.budgetUsd !== null ? <> of a <span className="num">{formatUsd(a.ai.month.budgetUsd)}</span> limit.</> : <>, no limit set.</>}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <div><h3 className="eyebrow mb-2">Spend per day</h3><BarChart title="AI spend per day" points={a.ai.spendByDay} format={(v) => formatUsd(v)} /></div>
              <div><h3 className="eyebrow mb-2">Requests per day</h3><BarChart title="AI requests per day" points={a.ai.requestsByDay} tone="muted" /></div>
            </div>
            {a.ai.byModel.length ? (
              <table className="mt-6 w-full text-left text-sm">
                <caption className="eyebrow mb-2 text-left">By model</caption>
                <thead><tr className="text-muted-foreground"><th className="py-1 font-medium">Model</th><th className="py-1 text-right font-medium">Requests</th><th className="py-1 text-right font-medium">Tokens</th><th className="py-1 text-right font-medium">Cost</th></tr></thead>
                <tbody>{a.ai.byModel.map((row) => (<tr key={row.modelId} className="border-t border-border/60"><td className="py-1.5 font-mono text-[13px]">{row.modelId}</td><td className="num py-1.5 text-right">{row.requests}</td><td className="num py-1.5 text-right">{formatTokens(row.totalTokens)}</td><td className="num py-1.5 text-right">{formatUsd(row.costUsd)}</td></tr>))}</tbody>
              </table>
            ) : null}
          </Section>

          <Section title="Activity">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              <Stat label="Conversations" value={String(a.activity.conversations)} note={`${a.activity.messagesSent} messages sent`} />
              <Stat label="Notes" value={String(a.activity.notesCreated)} />
              <Stat label="Documents added" value={String(a.activity.documentsAdded)} />
              <Stat label="Research reports" value={String(a.activity.researchReports)} />
              <Stat label="Events created" value={String(a.activity.calendarEventsCreated)} />
              <Stat label="Agent runs" value={String(Object.values(a.activity.agentRuns).reduce((s, n) => s + n, 0))} note={Object.entries(a.activity.agentRuns).map(([k, n]) => `${n} ${k}`).join(", ") || "none"} />
              <Stat label="Automation runs" value={String(Object.values(a.activity.automationRuns).reduce((s, n) => s + n, 0))} note={Object.entries(a.activity.automationRuns).map(([k, n]) => `${n} ${k}`).join(", ") || "none"} />
            </dl>
          </Section>
        </>
      ) : null}
    </div>
  );
}
