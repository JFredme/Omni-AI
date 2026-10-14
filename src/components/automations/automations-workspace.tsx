"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Workflow as WorkflowIcon } from "lucide-react";
import { RunStatusIcon, RUN_LABELS } from "@/components/automations/run-details";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { describeSchedule } from "@/lib/automations/schedule";
import { TEMPLATES } from "@/lib/automations/templates";
import { TRIGGER_INFO, type RunDto, type Trigger, type WorkflowDto } from "@/lib/automations/types";
import { formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function triggerSummary(trigger: Trigger): string {
  return trigger.type === "schedule" ? describeSchedule(trigger.schedule) : TRIGGER_INFO[trigger.type].label;
}

export function AutomationsWorkspace() {
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDto[] | null>(null);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, recent] = await Promise.all([apiRequest<{ workflows: WorkflowDto[] }>("/api/automations"), apiRequest<{ runs: RunDto[] }>("/api/automation-runs?limit=8")]);
      setWorkflows(list.workflows);
      setRuns(recent.runs);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't load your automations.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  async function create(templateId: string | null) {
    setCreating(templateId ?? "blank");
    setError(null);
    try {
      const template = TEMPLATES.find((entry) => entry.id === templateId);
      const { workflow } = await apiRequest<{ workflow: WorkflowDto }>("/api/automations", {
        json: template
          ? { name: template.name, description: template.description, trigger: template.trigger(zone), steps: template.steps(zone) }
          : { name: "Untitled automation", description: "", trigger: { type: "manual" }, steps: [] },
      });
      router.push(`/automations/${workflow.id}`);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't create the automation.");
      setCreating(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Automation"
        title="Automations"
        description="Things that happen on their own: on a schedule, when something changes, or when another service calls a private address. Each one starts switched off."
        actions={
          <Button variant="primary" onClick={() => void create(null)} disabled={creating !== null}>
            <Plus className="size-4" aria-hidden /> New automation
          </Button>
        }
      />
      {error ? <ErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}

      <section aria-labelledby="mine-heading" className="space-y-3">
        <h2 id="mine-heading" className="eyebrow">
          Yours{workflows ? ` · ${workflows.length}` : ""}
        </h2>
        {!workflows ? (
          <SkeletonRows count={2} />
        ) : workflows.length === 0 ? (
          <EmptyState icon={WorkflowIcon} title="No automations yet" description="Start from one of the ideas below, or build your own from scratch." />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {workflows.map((workflow) => (
              <li key={workflow.id}>
                <Link href={`/automations/${workflow.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:text-primary">
                  <span className={cn("size-2 shrink-0 rounded-full", workflow.enabled ? "bg-success" : "bg-muted-foreground/40")} title={workflow.enabled ? "On" : "Off"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{workflow.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {triggerSummary(workflow.trigger)} · {workflow.steps.length} {workflow.steps.length === 1 ? "step" : "steps"} · {workflow.enabled ? "On" : "Off"}
                    </span>
                  </span>
                  {workflow.lastRunStatus ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RunStatusIcon status={workflow.lastRunStatus} /> {RUN_LABELS[workflow.lastRunStatus]}
                      {workflow.lastRunAt ? <span className="num"> · {formatRelativeDate(workflow.lastRunAt)}</span> : null}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never run</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="templates-heading" className="space-y-3">
        <h2 id="templates-heading" className="eyebrow">
          Start from an idea
        </h2>
        <ul className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {TEMPLATES.map((template) => (
            <li key={template.id} className="space-y-1.5 border-t border-border pt-3">
              <p className="font-medium">{template.name}</p>
              <p className="text-sm text-muted-foreground">{template.description}</p>
              <Button size="sm" variant="outline" disabled={creating !== null} onClick={() => void create(template.id)} aria-label={`Use the template: ${template.name}`}>
                Use this
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {runs.length > 0 ? (
        <section aria-labelledby="recent-heading" className="space-y-3">
          <h2 id="recent-heading" className="eyebrow">
            Recent runs
          </h2>
          <ul className="divide-y divide-border border-y border-border text-sm">
            {runs.map((run) => (
              <li key={run.id}>
                <Link href={`/automations/${run.workflowId}`} className="flex items-center gap-3 py-2 hover:text-primary">
                  <RunStatusIcon status={run.status} />
                  <span className="min-w-0 flex-1 truncate">{run.workflowName ?? "Automation"}</span>
                  <span className="hidden text-xs text-muted-foreground sm:block">{RUN_LABELS[run.status]}</span>
                  <span className="num text-xs text-muted-foreground">{formatRelativeDate(run.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
