"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Copy, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { describeError } from "@/components/chat/use-model-catalog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import type { AgentDto, AgentRunDto, AgentRunSummaryDto } from "@/lib/agents/types";
import { isActiveStatus } from "@/lib/agents/types";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { formatRelativeDate } from "@/lib/format";
import { AgentDialog } from "./agent-dialog";
import { formatCost, RunStatusBadge } from "./agent-parts";

export function AgentsWorkspace() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentDto[] | null>(null);
  const [runs, setRuns] = useState<AgentRunSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [objective, setObjective] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ message: string; needsSetup: boolean } | null>(null);
  const [dialog, setDialog] = useState<{ agent: AgentDto | null; source?: AgentDto } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([apiRequest<{ agents: AgentDto[] }>("/api/agents"), apiRequest<{ runs: AgentRunSummaryDto[] }>("/api/agent-runs")])
      .then(([agentResult, runResult]) => {
        if (!active) return;
        setAgents(agentResult.agents);
        setRuns(runResult.runs);
        setError(null);
        setSelectedId((current) => (agentResult.agents.some((agent) => agent.id === current) ? current : (agentResult.agents[0]?.id ?? "")));
      })
      .catch((caught: unknown) => {
        if (active) setError(describeError(caught));
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  // Keep the run list fresh while anything is still running.
  const anyActive = runs?.some((run) => isActiveStatus(run.status)) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(reload, 2_000);
    return () => clearInterval(timer);
  }, [anyActive, reload]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId || !objective.trim()) return;
    setStarting(true);
    setStartError(null);
    try {
      const { run } = await apiRequest<{ run: AgentRunDto }>("/api/agent-runs", { json: { agentId: selectedId, objective: objective.trim() } });
      router.push(`/agents/runs/${run.id}`);
    } catch (caught) {
      const code = caught instanceof ClientApiError ? caught.code : "";
      setStartError({ message: describeError(caught), needsSetup: code === "api_key_missing" || code === "model_required" });
      setStarting(false);
    }
  }

  async function remove(agent: AgentDto) {
    try {
      await apiRequest(`/api/agents/${agent.id}`, { method: "DELETE" });
      setConfirmingDelete(null);
      reload();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  const selected = agents?.find((agent) => agent.id === selectedId);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bot}
        title="Agents"
        description="Agents plan, use your tools, and report back. Changes to your data wait for your approval by default."
        actions={
          <Button variant="primary" onClick={() => setDialog({ agent: null })}>
            <Plus className="size-4" aria-hidden />
            New agent
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}

      <Card className="space-y-3">
        <form onSubmit={start} className="space-y-3">
          <h2 className="text-base font-semibold">Run an agent</h2>
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <Select aria-label="Agent" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={!agents}>
              {(agents ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
            <Textarea
              aria-label="Objective"
              rows={2}
              value={objective}
              maxLength={4000}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="What should the agent do? For example: review my overdue tasks and suggest what to tackle first."
            />
          </div>
          {selected ? <p className="text-xs text-muted-foreground">{selected.description}</p> : null}
          {startError ? (
            <div className="space-y-2">
              <ErrorBanner message={startError.message} />
              {startError.needsSetup ? (
                <Link href="/settings" className="text-sm font-medium text-primary underline underline-offset-2">
                  Open settings
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={starting || !selectedId || !objective.trim()}>
              <Play className="size-4" aria-hidden />
              {starting ? "Starting…" : "Run agent"}
            </Button>
          </div>
        </form>
      </Card>

      <section aria-labelledby="runs-heading" className="space-y-3">
        <h2 id="runs-heading" className="text-base font-semibold">
          Recent runs
        </h2>
        {runs === null ? (
          error ? null : <SkeletonRows count={2} />
        ) : runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No runs yet. Pick an agent above and give it an objective.</p>
        ) : (
          <ul className="space-y-2" aria-label="Recent runs">
            {runs.map((run) => (
              <li key={run.id}>
                <Link href={`/agents/runs/${run.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card/70 px-3 py-2.5 transition-colors hover:bg-accent/40">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{run.objective}</span>
                    <span className="block text-xs text-muted-foreground">
                      {run.agentName} · {run.stepCount} step{run.stepCount === 1 ? "" : "s"} · {formatCost(run.costUsd)} · {formatRelativeDate(run.createdAt)}
                    </span>
                  </span>
                  <RunStatusBadge status={run.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="agents-heading" className="space-y-3">
        <h2 id="agents-heading" className="text-base font-semibold">
          Your agents
        </h2>
        {agents === null ? (
          error ? null : <SkeletonRows count={3} />
        ) : agents.length === 0 ? (
          <EmptyState icon={Bot} title="No agents yet" description="Create an agent to get started." />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Agents">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{agent.name}</h3>
                    {agent.builtIn ? <Badge tone="accent">Built-in</Badge> : null}
                  </div>
                  <p className="line-clamp-3 text-sm text-muted-foreground">{agent.description || "No description."}</p>
                  <p className="text-xs text-muted-foreground">
                    {agent.tools.length} tool{agent.tools.length === 1 ? "" : "s"} · up to {agent.maxSteps} steps · ${agent.maxBudgetUsd.toFixed(2)} budget
                  </p>
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setSelectedId(agent.id)} aria-label={`Select ${agent.name} to run`}>
                      <Play className="size-3.5" aria-hidden />
                      Run
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ agent: null, source: agent })} aria-label={`Duplicate ${agent.name}`}>
                      <Copy className="size-3.5" aria-hidden />
                      Duplicate
                    </Button>
                    {!agent.builtIn ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ agent })} aria-label={`Edit ${agent.name}`}>
                          <Pencil className="size-3.5" aria-hidden />
                          Edit
                        </Button>
                        {confirmingDelete === agent.id ? (
                          <>
                            <Button size="sm" className="bg-danger text-white hover:opacity-90" onClick={() => remove(agent)}>
                              Delete agent and its runs
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                              Keep
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirmingDelete(agent.id)} aria-label={`Delete ${agent.name}`}>
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        )}
                      </>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog ? (
        <AgentDialog
          key={dialog.agent?.id ?? dialog.source?.id ?? "new"}
          agent={dialog.agent}
          source={dialog.source}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setSelectedId(saved.id);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
