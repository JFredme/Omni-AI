"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ReportBody } from "@/components/research/report-view";
import { ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { formatRelativeDate } from "@/lib/format";
import type { ReportDto } from "@/lib/research/types";

export function ReportPage({ id }: { id: string }) {
  const [report, setReport] = useState<ReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ report: ReportDto }>(`/api/research/reports/${id}`)
      .then((data) => !cancelled && setReport(data.report))
      .catch((caught) => !cancelled && setError(caught instanceof ClientApiError ? caught.message : "Couldn't load that report."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/research" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Research
      </Link>
      {error ? <ErrorBanner message={error} /> : null}
      {!report && !error ? <SkeletonRows count={4} /> : null}
      {report ? (
        <>
          <header className="space-y-2 border-b border-border pb-5">
            <p className="eyebrow">
              {report.status === "complete" ? "Research report" : `Research · ${report.status}`} · {formatRelativeDate(report.createdAt)}
            </p>
            <h1 className="font-display text-3xl font-medium leading-tight">{report.question}</h1>
            {report.queries.length ? <p className="text-xs text-muted-foreground">Searched for: {report.queries.map((q) => `“${q}”`).join(", ")}</p> : null}
            {report.error ? <p className="text-sm text-warning">{report.error}</p> : null}
          </header>
          <ReportBody question={report.question} report={report.report} sources={report.sources} final reportId={report.id} />
        </>
      ) : null}
    </div>
  );
}
