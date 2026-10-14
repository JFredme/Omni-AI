"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, OctagonX, X } from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { describeError } from "@/components/chat/use-model-catalog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import type { AgentRunDto, AgentStepDto } from "@/lib/agents/types";
import { isActiveStatus } from "@/lib/agents/types";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatCost, RunStatusBadge, StepStatusBadge } from "./agent-parts";

export function RunView({ id }: { id: string }) {
  const [run, setRun] = useState<AgentRunDto | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const active = run ? isActiveStatus(run.status) && run.status !== "awaiting_approval" : true;

  useEffect(() => {
    let live = true;
    apiRequest<{ run: AgentRunDto }>(`/api/agent-runs/${id}`)
      .then((result) => {
        if (!live) return;
        setRun(result.run);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (live) setError({ message: describeError(caught), notFound: caught instanceof ClientApiError && caught.status === 404 });
      });
    return () => {
      live = false;
    };
  }, [id, reloadToken]);

  // Poll while the agent is working. A run waiting for approval doesn't change until the user acts.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(reload, 1_000);
    return () => clearInterval(timer);
  }, [active, reload]);

  async function decide(step: AgentStepDto, decision: "approve" | "reject") {
    setBusy(true);
    setBanner(null);
    try {
      const result = await apiRequest<{ run: AgentRunDto }>(`/api/agent-runs/${id}/steps/${step.id}`, { json: { decision } });
      setRun(result.run);
    } catch (caught) {
      setBanner(describeError(caught));
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      const result = await apiRequest<{ run: AgentRunDto }>(`/api/agent-runs/${id}/cancel`, { method: "POST" });
      setRun(result.run);
    } catch (caught) {
      setBanner(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Link href="/agents" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}>
          <ArrowLeft className="size-4" aria-hidden />
          Agents
        </Link>
        {error ? (
          error.notFound ? (
            <EmptyState icon={OctagonX} title="Run not found" description="It may have been deleted along with its agent." />
          ) : (
            <ErrorBanner message={error.message} onRetry={reload} />
          )
        ) : (
          <SkeletonRows count={3} />
        )}
      </div>
    );
  }

  const pending = run.steps.find((step) => step.status === "pending_approval");
  const cancellable = isActiveStatus(run.status);

  return (
    <div className="space-y-5">
      <Link href="/agents" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}>
        <ArrowLeft className="size-4" aria-hidden />
        Agents
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{run.agentName}</h1>
          <RunStatusBadge status={run.status} />
          {cancellable ? (
            <Button variant="outline" size="sm" className="ml-auto" onClick={cancel} disabled={busy}>
              <OctagonX className="size-4" aria-hidden />
              Cancel run
            </Button>
          ) : null}
        </div>
        <p className="break-words text-sm text-muted-foreground">{run.objective}</p>
        <p className="text-xs text-muted-foreground">
          {run.stepCount} of {run.maxSteps} steps · {formatCost(run.costUsd)} of {formatCost(run.budgetUsd)} · {formatTokens(run.totalTokens)} tokens
        </p>
      </header>

      {banner ? <ErrorBanner message={banner} onDismiss={() => setBanner(null)} /> : null}
      {error ? <ErrorBanner message={error.message} onRetry={reload} /> : null}
      {run.error ? <ErrorBanner message={run.error} /> : null}

      {pending ? (
        <Card className="space-y-3 border-warning/60" role="region" aria-label="Approval needed">
          <div>
            <h2 className="font-semibold">Approval needed</h2>
            <p className="text-sm text-muted-foreground">
              The agent wants to run <code className="font-mono">{pending.tool}</code>. Nothing happens until you decide.
            </p>
          </div>
          {pending.thought ? <p className="text-sm">{pending.thought}</p> : null}
          <pre className="overflow-x-auto rounded-xl border border-border bg-muted/60 p-3 font-mono text-[13px]">{JSON.stringify(pending.input, null, 2)}</pre>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => decide(pending, "reject")} disabled={busy}>
              <X className="size-4" aria-hidden />
              Decline
            </Button>
            <Button variant="primary" onClick={() => decide(pending, "approve")} disabled={busy}>
              <Check className="size-4" aria-hidden />
              Approve
            </Button>
          </div>
        </Card>
      ) : null}

      {run.result ? (
        <Card className="space-y-2" role="region" aria-label="Result">
          <h2 className="font-semibold">Result</h2>
          <Markdown>{run.result}</Markdown>
        </Card>
      ) : null}

      <section aria-labelledby="steps-heading" className="space-y-3">
        <h2 id="steps-heading" className="text-base font-semibold">
          Steps
        </h2>
        {run.steps.filter((step) => step.kind !== "final").length === 0 ? (
          <p className="text-sm text-muted-foreground">{active ? "Working on it…" : "The agent answered without using any tools."}</p>
        ) : (
          <ol className="space-y-2" aria-label="Steps">
            {run.steps
              .filter((step) => step.kind !== "final")
              .map((step) => (
                <StepCard key={step.id} step={step} />
              ))}
          </ol>
        )}
      </section>

      {run.childRuns.length > 0 ? (
        <section aria-labelledby="delegated-heading" className="space-y-2">
          <h2 id="delegated-heading" className="text-base font-semibold">
            Delegated tasks
          </h2>
          <ul className="space-y-2">
            {run.childRuns.map((child) => (
              <li key={child.id}>
                <Link href={`/agents/runs/${child.id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-sm hover:bg-accent/40">
                  <span className="font-medium">{child.agentName}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{child.objective}</span>
                  <RunStatusBadge status={child.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function StepCard({ step }: { step: AgentStepDto }) {
  const [open, setOpen] = useState(false);
  const long = (step.output?.length ?? 0) > 400;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Step {step.index + 1}</span>
        {step.kind === "invalid" ? <span className="text-sm font-medium">Unusable reply</span> : <code className="font-mono text-sm font-medium">{step.tool}</code>}
        <StepStatusBadge status={step.status} />
      </div>
      {step.thought ? <p className="text-sm text-muted-foreground">{step.thought}</p> : null}
      {step.kind === "action" && step.input && Object.keys(step.input as object).length > 0 ? (
        <pre className="overflow-x-auto rounded-lg bg-muted/60 p-2 font-mono text-xs">{JSON.stringify(step.input)}</pre>
      ) : null}
      {step.output ? (
        <div>
          <pre className={cn("overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-2 font-mono text-xs", !open && long && "max-h-28 overflow-hidden")}>{step.output}</pre>
          {long ? (
            <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-primary underline underline-offset-2">
              {open ? "Show less" : "Show all"}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
