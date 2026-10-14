"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Square, Trash2 } from "lucide-react";
import { ReportBody } from "@/components/research/report-view";
import { SearchSettingsCard } from "@/components/research/search-settings-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError, isAbortError, streamEvents } from "@/lib/client/api";
import { formatRelativeDate } from "@/lib/format";
import { DEPTH_SETTINGS, DEPTHS, type Depth, type ReportDto, type ResearchEvent, type SearchSettingsDto, type SourceDto } from "@/lib/research/types";

interface Live {
  reportId: string | null;
  question: string;
  steps: string[];
  queries: string[];
  sources: SourceDto[];
  text: string;
  final: ReportDto | null;
}

export function ResearchWorkspace() {
  const [search, setSearch] = useState<SearchSettingsDto | null>(null);
  const [question, setQuestion] = useState("");
  const [depth, setDepth] = useState<Depth>("quick");
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [past, setPast] = useState<ReportDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadPast = useCallback(async () => {
    try {
      setPast((await apiRequest<{ reports: ReportDto[] }>("/api/research")).reports);
    } catch {
      // The list is a convenience; the form still works without it.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void loadPast();
    apiRequest<{ settings: SearchSettingsDto }>("/api/research/settings")
      .then((data) => setSearch(data.settings))
      .catch(() => undefined);
  }, [loadPast]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setLive({ reportId: null, question: question.trim(), steps: [], queries: [], sources: [], text: "", final: null });
    let reportId: string | null = null;
    try {
      await streamEvents<ResearchEvent>("/api/research", { question, depth }, {
        signal: controller.signal,
        onEvent: (e) => {
          setLive((prev) => {
            if (!prev) return prev;
            switch (e.type) {
              case "start":
                return { ...prev, reportId: e.reportId };
              case "status":
                return { ...prev, steps: [...prev.steps, e.message] };
              case "queries":
                return { ...prev, queries: e.queries };
              case "sources":
                return { ...prev, sources: e.sources };
              case "delta":
                return { ...prev, text: prev.text + e.text };
              case "done":
                return { ...prev, final: e.report, text: e.report.report, sources: e.report.sources };
              case "error":
                return { ...prev, final: e.report };
              default:
                return prev;
            }
          });
          if (e.type === "start") reportId = e.reportId;
          if (e.type === "error") setError(e.message);
        },
      });
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof ClientApiError ? caught.message : "The research couldn't start.");
      setLive((prev) => (prev && !prev.final && prev.steps.length === 0 ? null : prev));
    } finally {
      abortRef.current = null;
      setRunning(false);
      // If the connection was cut (Stop), the server still saves what it had; fetch it so the screen reflects that.
      if (reportId) await settleLive(reportId);
      await loadPast();
    }
  }

  async function settleLive(id: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const { report } = await apiRequest<{ report: ReportDto }>(`/api/research/reports/${id}`);
        if (report.status !== "running") {
          setLive((prev) => (prev && prev.reportId === id && !prev.final ? { ...prev, final: report, text: report.report, sources: report.sources } : prev));
          return;
        }
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  async function remove(id: string) {
    try {
      await apiRequest(`/api/research/reports/${id}`, { method: "DELETE" });
      await loadPast();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't delete that report.");
    }
  }

  const ready = search?.ready ?? false;
  const trimmed = question.trim();

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Knowledge" title="Research" description="Ask a question. Omni plans searches, reads real web pages, and writes a report where every claim points to a source it actually found." />

      {search && !search.ready ? (
        <section aria-label="Set up web search" className="max-w-xl space-y-3">
          <p className="text-sm text-muted-foreground">Research needs a web search service first. Choose one and add its key, then come back.</p>
          <SearchSettingsCard compact onChange={setSearch} />
        </section>
      ) : null}

      <form onSubmit={start} className="max-w-3xl space-y-3">
        <Field label="Your question" htmlFor="research-question" hint={`${trimmed.length}/1000`}>
          <Textarea id="research-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} maxLength={1000} placeholder="For example: How has the cost of solar power changed in the last ten years?" disabled={running} />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Depth" htmlFor="research-depth">
            <Select id="research-depth" value={depth} onChange={(e) => setDepth(e.target.value as Depth)} disabled={running} className="w-56">
              {DEPTHS.map((d) => (
                <option key={d} value={d}>
                  {DEPTH_SETTINGS[d].label}
                </option>
              ))}
            </Select>
          </Field>
          {running ? (
            // A separate key keeps this a different button from "Research": otherwise the same element turns back into a
            // submit button during the click that stops the run, and the click submits the form again.
            <Button key="stop" variant="outline" onClick={() => abortRef.current?.abort()}>
              <Square className="size-3.5 fill-current" aria-hidden /> Stop
            </Button>
          ) : (
            <Button key="start" type="submit" variant="primary" disabled={!ready || trimmed.length < 8}>
              Research
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Uses your default model and your search service, so it costs a little. Page text is sent to the model to write the report.</p>
      </form>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {live ? (
        <section aria-label="Current research" className="max-w-3xl space-y-5">
          <h2 className="font-display text-2xl font-medium leading-tight">{live.question}</h2>
          {!live.final || live.final.status !== "complete" ? (
            <ul aria-label="Progress" className="space-y-1.5 text-sm">
              {live.steps.map((step, index) => (
                <li key={`${step}-${index}`} className="flex items-center gap-2 text-muted-foreground">
                  {index === live.steps.length - 1 && running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
                  {step}
                </li>
              ))}
            </ul>
          ) : null}
          {live.queries.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Searched for: {live.queries.map((query) => `“${query}”`).join(", ")}
            </p>
          ) : null}
          {live.final?.status === "failed" ? null : <ReportBody question={live.question} report={live.text} sources={live.sources} final={Boolean(live.final)} />}
          {live.final && live.final.status !== "complete" ? <p className="text-sm text-muted-foreground">{live.final.status === "stopped" ? "Stopped. What was written so far is saved below." : live.final.error}</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="past-heading" className="max-w-3xl space-y-3">
        <h2 id="past-heading" className="eyebrow">
          Past research{past.length ? ` · ${past.length}` : ""}
        </h2>
        {past.length === 0 ? (
          <p className="border-y border-dashed border-border py-6 text-center text-sm text-muted-foreground">Nothing yet. Reports you run are kept here.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {past.map((report) => (
              <li key={report.id} className="flex items-center gap-3 py-3">
                <Link href={`/research/${report.id}`} className="min-w-0 flex-1 hover:text-primary">
                  <span className="block truncate font-medium">{report.question}</span>
                  <span className="num block text-xs text-muted-foreground">
                    {report.status === "complete" ? `${report.sources.length} sources` : report.status} · {formatRelativeDate(report.createdAt)}
                  </span>
                </Link>
                <Button size="icon" variant="ghost" aria-label={`Delete the report: ${report.question}`} onClick={() => void remove(report.id)}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
