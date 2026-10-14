"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, FileText, Library } from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { ExportMenu } from "@/components/export-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { linkCitations, validateCitations } from "@/lib/research/citations";
import type { SourceDto } from "@/lib/research/types";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The report as Markdown with its sources listed at the end, for saving or copying. */
export function reportMarkdown(question: string, report: string, sources: SourceDto[]): string {
  const list = sources.map((source) => `${source.n}. [${source.title}](${source.url})${source.read ? "" : " (search snippet only)"}`).join("\n");
  return `# ${question}\n\n${report}\n\n## Sources\n\n${list}\n`;
}

export function SourceList({ sources }: { sources: SourceDto[] }) {
  if (sources.length === 0) return null;
  return (
    <ol aria-label="Sources" className="divide-y divide-border border-y border-border">
      {sources.map((source) => (
        <li key={source.n} id={`source-${source.n}`} className="flex gap-3 py-3 target:bg-primary/5">
          <span className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium">{source.n}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-medium hover:text-primary">
              <span className="truncate">{source.title}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
            <p className="truncate text-xs text-muted-foreground">{hostOf(source.url)}</p>
            {source.snippet ? <p className="line-clamp-2 text-xs text-muted-foreground">{source.snippet}</p> : null}
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              {source.read ? <Badge tone="success">Page read</Badge> : <Badge>Search snippet only</Badge>}
              {source.cited ? <Badge tone="accent">Cited</Badge> : <Badge>Not cited</Badge>}
              {source.note ? <span className="text-muted-foreground">{source.note}</span> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A finished (or in-progress) report with citations as links, and ways to keep it. */
export function ReportBody({ question, report, sources, final, reportId }: { question: string; report: string; sources: SourceDto[]; final: boolean; reportId?: string }) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markdown = reportMarkdown(question, report, sources);
  // While the report is still being written, hide citation numbers that don't match a source; the saved report drops them for good.
  const shown = final ? report : validateCitations(report, sources).report;

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "That didn't work.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Markdown>{linkCitations(shown, sources.length)}</Markdown>
        {!final ? <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-foreground align-middle" aria-hidden /> : null}
      </div>

      {final && report ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(markdown);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setError("Couldn't copy to the clipboard.");
              }
            }}
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copied ? "Copied" : "Copy as Markdown"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void run(() => apiRequest("/api/notes", { json: { title: `Research: ${question}`.slice(0, 200), content: markdown, tags: ["research"] } }), "Saved as a note.")}>
            <FileText className="size-3.5" aria-hidden /> Save as note
          </Button>
          <Button size="sm" variant="outline" onClick={() => void run(() => apiRequest("/api/knowledge", { json: { name: `Research: ${question}`.slice(0, 200), text: markdown } }), "Added to Knowledge, so chat can use it.")}>
            <Library className="size-3.5" aria-hidden /> Add to Knowledge
          </Button>
          {reportId ? (
            <ExportMenu
              options={[
                { label: "PDF", href: `/api/research/reports/${reportId}/export?format=pdf` },
                { label: "Word (.docx)", href: `/api/research/reports/${reportId}/export?format=docx` },
                { label: "Markdown", href: `/api/research/reports/${reportId}/export?format=md` },
              ]}
              align="left"
            />
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      ) : null}
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {sources.length > 0 ? (
        <section aria-labelledby="sources-heading" className="space-y-2">
          <h2 id="sources-heading" className="eyebrow">
            Sources · {sources.length}
          </h2>
          <SourceList sources={sources} />
        </section>
      ) : null}
    </div>
  );
}
