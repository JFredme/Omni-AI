"use client";

import { AlertCircle, CheckCircle2, CircleSlash, Loader2, MinusCircle } from "lucide-react";
import { STEP_INFO, TRIGGER_INFO, type RunDto, type RunStatus } from "@/lib/automations/types";
import { formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const RUN_LABELS: Record<RunStatus, string> = { running: "Running", succeeded: "Succeeded", failed: "Failed", skipped: "Stopped by a condition" };

export function RunStatusIcon({ status, className }: { status: RunStatus | "ok" | "error"; className?: string }) {
  const cls = cn("size-4 shrink-0", className);
  if (status === "running") return <Loader2 className={cn(cls, "animate-spin text-muted-foreground")} aria-hidden />;
  if (status === "succeeded" || status === "ok") return <CheckCircle2 className={cn(cls, "text-success")} aria-hidden />;
  if (status === "failed" || status === "error") return <AlertCircle className={cn(cls, "text-danger")} aria-hidden />;
  return <CircleSlash className={cn(cls, "text-muted-foreground")} aria-hidden />;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** What one run did, step by step, with what each step was given and what it produced. */
export function RunDetails({ run }: { run: RunDto }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <RunStatusIcon status={run.status} /> {RUN_LABELS[run.status]}
        </span>
        <span className="text-muted-foreground">Started by: {TRIGGER_INFO[run.triggerType]?.label.toLowerCase() ?? run.triggerType}</span>
        <span className="num text-muted-foreground">{formatRelativeDate(run.startedAt)}</span>
      </p>
      {run.error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger">
          {run.error}
        </p>
      ) : null}
      <ol className="divide-y divide-border border-y border-border">
        {run.steps.map((step) => (
          <li key={step.id} className="py-2">
            <details>
              <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                {step.status === "skipped" ? <MinusCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <RunStatusIcon status={step.status} />}
                <span className="num text-xs text-muted-foreground">{step.index + 1}</span>
                <span className="font-medium">{STEP_INFO[step.type]?.label ?? step.type}</span>
                <span className="ml-auto text-xs text-muted-foreground">{step.status === "skipped" ? "skipped" : step.status === "error" ? "failed" : step.status}</span>
              </summary>
              <div className="mt-2 space-y-2 pl-6">
                {step.error ? <p className="text-danger">{step.error}</p> : null}
                {step.input !== null && step.input !== undefined ? (
                  <div>
                    <p className="eyebrow mb-1">Given</p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-xs">{show(step.input)}</pre>
                  </div>
                ) : null}
                {step.output !== null && step.output !== undefined ? (
                  <div>
                    <p className="eyebrow mb-1">Produced</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-xs">{show(step.output)}</pre>
                  </div>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}
