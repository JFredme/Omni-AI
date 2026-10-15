"use client";

import { useEffect, useId, useState } from "react";
import { describeError } from "@/components/chat/use-model-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { MAX_AGENT_BUDGET_USD, MAX_AGENT_STEPS, type AgentDto } from "@/lib/agents/types";
import { apiRequest } from "@/lib/client/api";
import type { CatalogModel } from "@/lib/openrouter/models";

interface ToolInfo {
  name: string;
  description: string;
  risk: "read" | "write" | "computer";
}

/** Creates or edits a custom agent. With `source` set to a built-in agent, it creates an editable copy. */
export function AgentDialog({
  agent,
  source,
  onClose,
  onSaved,
}: {
  agent: AgentDto | null;
  source?: AgentDto;
  onClose: () => void;
  onSaved: (agent: AgentDto) => void;
}) {
  const formId = useId();
  const base = agent ?? source ?? null;
  const [name, setName] = useState(source && !agent ? `${source.name} (copy)` : (base?.name ?? ""));
  const [description, setDescription] = useState(base?.description ?? "");
  const [instructions, setInstructions] = useState(base?.instructions ?? "");
  const [modelId, setModelId] = useState(base?.modelId ?? "");
  const [tools, setTools] = useState<string[]>(base?.tools ?? []);
  const [approval, setApproval] = useState<string[]>(base?.approvalTools ?? []);
  const [maxSteps, setMaxSteps] = useState(String(base?.maxSteps ?? 10));
  const [maxBudget, setMaxBudget] = useState(String(base?.maxBudgetUsd ?? 0.25));
  const [catalog, setCatalog] = useState<ToolInfo[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ tools: ToolInfo[] }>("/api/agent-tools")
      .then((result) => setCatalog(result.tools))
      .catch((caught: unknown) => setError(describeError(caught)));
    apiRequest<{ models: CatalogModel[] }>("/api/models")
      .then((result) => setModels(result.models.map((model) => model.id)))
      .catch(() => undefined);
  }, []);

  function toggleTool(toolName: string, risk: ToolInfo["risk"]) {
    if (tools.includes(toolName)) {
      setTools((prev) => prev.filter((value) => value !== toolName));
      setApproval((prev) => prev.filter((value) => value !== toolName));
    } else {
      setTools((prev) => [...prev, toolName]);
      if (risk === "write" || risk === "computer") setApproval((prev) => [...prev, toolName]);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the agent a name.");
      return;
    }
    const steps = Number(maxSteps);
    const budget = Number(maxBudget);
    if (!Number.isInteger(steps) || steps < 1 || steps > MAX_AGENT_STEPS) {
      setError(`Maximum steps must be a whole number from 1 to ${MAX_AGENT_STEPS}.`);
      return;
    }
    if (!Number.isFinite(budget) || budget < 0.01 || budget > MAX_AGENT_BUDGET_USD) {
      setError(`Maximum budget must be between $0.01 and $${MAX_AGENT_BUDGET_USD}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        description,
        instructions,
        modelId: modelId.trim() || null,
        tools,
        approvalTools: approval.filter((value) => tools.includes(value)),
        maxSteps: steps,
        maxBudgetUsd: budget,
      };
      const result = agent
        ? await apiRequest<{ agent: AgentDto }>(`/api/agents/${agent.id}`, { method: "PATCH", json: body })
        : await apiRequest<{ agent: AgentDto }>("/api/agents", { json: body });
      onSaved(result.agent);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={agent ? "Edit agent" : source ? "Duplicate agent" : "New agent"}
      description="Choose what this agent knows, which tools it can use, and the limits it must stay within."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? "Saving…" : agent ? "Save changes" : "Create agent"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
        <Field label="Name" htmlFor={`${formId}-name`}>
          <Input id={`${formId}-name`} data-autofocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Description" htmlFor={`${formId}-description`}>
          <Input id={`${formId}-description`} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="What is this agent for?" />
        </Field>
        <Field label="Instructions" htmlFor={`${formId}-instructions`} hint="How the agent should behave, in plain language.">
          <Textarea id={`${formId}-instructions`} rows={5} value={instructions} maxLength={8000} onChange={(event) => setInstructions(event.target.value)} />
        </Field>
        <Field label="Model" htmlFor={`${formId}-model`} hint="Leave empty to use your default model.">
          <Input id={`${formId}-model`} list={`${formId}-models`} value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="Default model" />
          <datalist id={`${formId}-models`}>
            {models.slice(0, 400).map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Tools and permissions</legend>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {catalog.map((tool) => {
              const enabled = tools.includes(tool.name);
              return (
                <li key={tool.name} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleTool(tool.name, tool.risk)}
                    aria-label={`Allow ${tool.name}`}
                    className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <code className="font-mono text-[13px]">{tool.name}</code>
                      <Badge className={tool.risk === "read" ? undefined : "bg-warning/25 text-foreground"}>{tool.risk === "write" ? "Changes data" : tool.risk === "computer" ? "Uses your computer" : "Read only"}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">{tool.description}</p>
                  </div>
                  {enabled && tool.risk === "computer" ? <span className="text-xs text-muted-foreground">Always asks first</span> : null}
                  {enabled && tool.risk === "write" ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={approval.includes(tool.name)}
                        onChange={(event) =>
                          setApproval((prev) => (event.target.checked ? [...prev, tool.name] : prev.filter((value) => value !== tool.name)))
                        }
                        aria-label={`Ask before using ${tool.name}`}
                        className="size-4 accent-[var(--primary)]"
                      />
                      Ask me first
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">An agent can only use tools you turn on. Actions marked &quot;Ask me first&quot; pause until you approve them.</p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Maximum steps" htmlFor={`${formId}-steps`} hint="The run stops after this many actions.">
            <Input id={`${formId}-steps`} inputMode="numeric" value={maxSteps} onChange={(event) => setMaxSteps(event.target.value)} />
          </Field>
          <Field label="Maximum budget (USD)" htmlFor={`${formId}-budget`} hint="The run stops once its AI cost reaches this.">
            <Input id={`${formId}-budget`} inputMode="decimal" value={maxBudget} onChange={(event) => setMaxBudget(event.target.value)} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
