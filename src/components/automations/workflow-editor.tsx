"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Filter, FileText, Globe, ListPlus, Loader2, CalendarPlus, Play, Plus, Search, Trash2, Wand2, Zap } from "lucide-react";
import { RunDetails, RunStatusIcon, RUN_LABELS } from "@/components/automations/run-details";
import { StepForm } from "@/components/automations/step-forms";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { describeSchedule } from "@/lib/automations/schedule";
import { blankStep } from "@/lib/automations/templates";
import { MAX_STEPS, STEP_INFO, STEP_TYPES, TRIGGER_INFO, TRIGGER_TYPES, type RunDto, type ScheduleSpec, type Step, type StepType, type Trigger, type WorkflowDto } from "@/lib/automations/types";
import { formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEP_ICONS: Record<StepType, typeof Zap> = {
  fetch_tasks: Search,
  fetch_events: Search,
  ai_prompt: Wand2,
  create_task: ListPlus,
  create_note: FileText,
  create_event: CalendarPlus,
  http_request: Globe,
  condition: Filter,
};

const KIND_BADGE: Record<string, string> = { read: "Reads", write: "Changes your data", ai: "Uses AI (costs money)", external: "Calls another service", logic: "Logic" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function message(error: unknown, fallback: string) {
  return error instanceof ClientApiError ? error.message : fallback;
}

export function WorkflowEditor({ id }: { id: string }) {
  const router = useRouter();
  const zone = useMemo(() => localZone(), []);
  const [saved, setSaved] = useState<WorkflowDto | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<Trigger>({ type: "manual" });
  const [steps, setSteps] = useState<Step[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [latest, setLatest] = useState<RunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const adopt = useCallback((workflow: WorkflowDto) => {
    setSaved(workflow);
    setName(workflow.name);
    setDescription(workflow.description);
    setTrigger(workflow.trigger);
    setSteps(workflow.steps);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<{ workflow: WorkflowDto; runs: RunDto[] }>(`/api/automations/${id}`);
      adopt(data.workflow);
      setRuns(data.runs);
    } catch (caught) {
      setError(message(caught, "Couldn't load this automation."));
    }
  }, [id, adopt]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  const dirty = saved !== null && JSON.stringify({ name, description, trigger, steps }) !== JSON.stringify({ name: saved.name, description: saved.description, trigger: saved.trigger, steps: saved.steps });

  async function save(extra: { enabled?: boolean } = {}) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { workflow } = await apiRequest<{ workflow: WorkflowDto }>(`/api/automations/${id}`, { method: "PATCH", json: { name, description, trigger, steps, ...extra } });
      adopt(workflow);
      setNotice(extra.enabled === undefined ? "Saved." : extra.enabled ? "Switched on." : "Switched off.");
    } catch (caught) {
      setError(message(caught, "Couldn't save."));
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const { run } = await apiRequest<{ run: RunDto }>(`/api/automations/${id}/run`, { method: "POST", json: {} });
      setLatest(run);
      const data = await apiRequest<{ workflow: WorkflowDto; runs: RunDto[] }>(`/api/automations/${id}`);
      setSaved(data.workflow);
      setRuns(data.runs);
    } catch (caught) {
      setError(message(caught, "The run couldn't start."));
    } finally {
      setRunning(false);
    }
  }

  async function createAddress() {
    setError(null);
    try {
      const { token } = await apiRequest<{ token: string }>(`/api/automations/${id}/webhook`, { method: "POST", json: {} });
      setWebhookUrl(`${window.location.origin}/api/hooks/${token}`);
      await load();
    } catch (caught) {
      setError(message(caught, "Couldn't create the address."));
    }
  }

  async function remove() {
    try {
      await apiRequest(`/api/automations/${id}`, { method: "DELETE" });
      router.push("/automations");
    } catch (caught) {
      setError(message(caught, "Couldn't delete this automation."));
      setConfirmDelete(false);
    }
  }

  const updateStep = (index: number, step: Step) => setSteps((prev) => prev.map((existing, i) => (i === index ? step : existing)));
  const move = (index: number, offset: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(index + offset, 0, moved);
      return next;
    });

  if (!saved && !error) return <SkeletonRows count={4} />;
  if (!saved) return <ErrorBanner message={error ?? "Not found."} />;

  return (
    <div className="space-y-6">
      <Link href="/automations" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Automations
      </Link>

      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <Input aria-label="Automation name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-auto border-transparent bg-transparent px-0 font-display text-3xl font-medium focus:border-input" />
          <Input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this for?" maxLength={1000} className="border-transparent bg-transparent px-0 text-sm text-muted-foreground focus:border-input" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={saved.enabled}
            aria-label={saved.enabled ? "Switch off" : "Switch on"}
            onClick={() => void save({ enabled: !saved.enabled })}
            disabled={saving}
            className={cn("flex h-9 items-center gap-2 rounded-lg border px-3 text-sm", saved.enabled ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground")}
          >
            <span className={cn("size-2 rounded-full", saved.enabled ? "bg-primary" : "bg-muted-foreground/50")} />
            {saved.enabled ? "On" : "Off"}
          </button>
          <Button variant="outline" onClick={() => void runNow()} disabled={running || dirty || steps.length === 0} title={dirty ? "Save your changes first" : steps.length === 0 ? "Add a step first" : "Run it once, right now"}>
            {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />} Run now
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}
      {dirty ? <p className="text-xs text-warning">You have unsaved changes.</p> : null}
      {saved.enabled && saved.nextRunAt ? <p className="text-xs text-muted-foreground">Next run {new Date(saved.nextRunAt).toLocaleString()}</p> : null}

      <section aria-label="Flow" className="mx-auto max-w-2xl">
        <TriggerNode
          trigger={trigger}
          onChange={setTrigger}
          zone={zone}
          hasWebhook={saved.hasWebhook}
          webhookUrl={webhookUrl}
          copied={copied}
          onCopy={async () => {
            if (!webhookUrl) return;
            try {
              await navigator.clipboard.writeText(webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
          onCreateAddress={() => void createAddress()}
          unsaved={saved.trigger.type !== trigger.type}
        />

        {steps.map((step, index) => {
          const Icon = STEP_ICONS[step.type];
          return (
            <div key={step.id}>
              <Connector onAdd={steps.length < MAX_STEPS ? () => setAdding(index) : undefined} label={`Add a step before step ${index + 1}`} />
              <article aria-label={`Step ${index + 1}: ${STEP_INFO[step.type].label}`} className="rounded-lg border border-border bg-card">
                <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                  <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium">{index + 1}</span>
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{STEP_INFO[step.type].label}</h2>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{KIND_BADGE[STEP_INFO[step.type].kind]}</span>
                  <Button size="icon" variant="ghost" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Move step ${index + 1} down`} disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Remove step ${index + 1}`} onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </header>
                <div className="p-4">
                  <StepForm step={step} index={index} trigger={trigger} steps={steps} zone={zone} onChange={(next) => updateStep(index, next)} />
                </div>
              </article>
            </div>
          );
        })}

        <Connector />
        {steps.length < MAX_STEPS ? (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setAdding(steps.length)}>
              <Plus className="size-4" aria-hidden /> Add a step
            </Button>
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground">An automation can have up to {MAX_STEPS} steps.</p>
        )}
      </section>

      {latest ? (
        <section aria-label="Result of the last manual run" className="mx-auto max-w-2xl rounded-lg border border-border p-4">
          <h2 className="eyebrow mb-3">Result of the run you just started</h2>
          <RunDetails run={latest} />
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="mx-auto max-w-2xl space-y-3">
        <h2 id="history-heading" className="eyebrow">
          Run history
        </h2>
        {runs.length === 0 ? (
          <p className="border-y border-dashed border-border py-6 text-center text-sm text-muted-foreground">It hasn&apos;t run yet.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {runs.map((run) => (
              <li key={run.id} className="py-2">
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
                    <RunStatusIcon status={run.status} />
                    <span className="font-medium">{RUN_LABELS[run.status]}</span>
                    <span className="num ml-auto text-xs text-muted-foreground">{formatRelativeDate(run.startedAt)}</span>
                  </summary>
                  <div className="mt-3 pl-6">
                    <RunDetails run={run} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mx-auto max-w-2xl border-t border-border pt-4">
        <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-4" aria-hidden /> Delete this automation
        </Button>
      </div>

      {adding !== null ? (
        <Dialog title="Add a step" description="Steps run in order. Each can use what the ones before it produced." onClose={() => setAdding(null)} footer={<Button variant="outline" onClick={() => setAdding(null)}>Cancel</Button>}>
          <ul className="space-y-1.5">
            {STEP_TYPES.map((type) => {
              const Icon = STEP_ICONS[type];
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => {
                      setSteps((prev) => [...prev.slice(0, adding), blankStep(type, zone), ...prev.slice(adding)]);
                      setAdding(null);
                    }}
                    className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-accent"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span>
                      <span className="block text-sm font-medium">{STEP_INFO[type].label}</span>
                      <span className="block text-xs text-muted-foreground">{STEP_INFO[type].description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Dialog>
      ) : null}

      {confirmDelete ? (
        <Dialog
          title="Delete this automation?"
          description={`"${saved.name}" and its run history will be removed. Anything it already created stays.`}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="primary" className="bg-danger hover:bg-danger/90" onClick={() => void remove()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">This can&apos;t be undone.</p>
        </Dialog>
      ) : null}
    </div>
  );
}

function Connector({ onAdd, label }: { onAdd?: () => void; label?: string }) {
  return (
    <div className="flex flex-col items-center py-1" aria-hidden={!onAdd}>
      <span className="h-3 w-px bg-border" />
      {onAdd ? (
        <button type="button" onClick={onAdd} aria-label={label} className="flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary">
          <Plus className="size-3.5" aria-hidden />
        </button>
      ) : null}
      <span className="h-3 w-px bg-border" />
    </div>
  );
}

function TriggerNode({
  trigger,
  onChange,
  zone,
  hasWebhook,
  webhookUrl,
  copied,
  onCopy,
  onCreateAddress,
  unsaved,
}: {
  trigger: Trigger;
  onChange: (trigger: Trigger) => void;
  zone: string;
  hasWebhook: boolean;
  webhookUrl: string | null;
  copied: boolean;
  onCopy: () => void;
  onCreateAddress: () => void;
  unsaved: boolean;
}) {
  const info = TRIGGER_INFO[trigger.type];
  const schedule = trigger.type === "schedule" ? trigger.schedule : null;
  const setSchedule = (next: ScheduleSpec) => onChange({ type: "schedule", schedule: next });

  return (
    <article aria-label="Trigger" className="rounded-lg border border-primary/40 bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Zap className="size-4 shrink-0 text-primary" aria-hidden />
        <h2 className="eyebrow !text-foreground">Starts</h2>
      </header>
      <div className="space-y-3 p-4">
        <Field label="This automation starts…" htmlFor="trigger-type" hint={info.description}>
          <Select
            id="trigger-type"
            value={trigger.type}
            onChange={(e) => {
              const type = e.target.value as Trigger["type"];
              onChange(type === "schedule" ? { type, schedule: { frequency: "daily", time: "08:00", timezone: zone } } : { type });
            }}
          >
            {TRIGGER_TYPES.map((type) => (
              <option key={type} value={type}>
                {TRIGGER_INFO[type].label}
              </option>
            ))}
          </Select>
        </Field>

        {schedule ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How often" htmlFor="schedule-frequency">
                <Select
                  id="schedule-frequency"
                  value={schedule.frequency}
                  onChange={(e) => {
                    const frequency = e.target.value;
                    setSchedule(
                      frequency === "interval" ? { frequency, everyMinutes: 60, timezone: schedule.timezone } : frequency === "daily" ? { frequency, time: "08:00", timezone: schedule.timezone } : { frequency: "weekly", time: "08:00", days: [1, 2, 3, 4, 5], timezone: schedule.timezone },
                    );
                  }}
                >
                  <option value="interval">Every so many minutes</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">On certain days</option>
                </Select>
              </Field>
              {schedule.frequency === "interval" ? (
                <Field label="Every (minutes)" htmlFor="schedule-minutes" hint="At least 5.">
                  <Input id="schedule-minutes" type="number" min={5} max={1440} value={schedule.everyMinutes} onChange={(e) => setSchedule({ ...schedule, everyMinutes: Number(e.target.value) })} />
                </Field>
              ) : (
                <Field label="At" htmlFor="schedule-time">
                  <Input id="schedule-time" type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
                </Field>
              )}
            </div>
            {schedule.frequency === "weekly" ? (
              <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day, index) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={schedule.days.includes(index)}
                    onClick={() => setSchedule({ ...schedule, days: schedule.days.includes(index) ? schedule.days.filter((d) => d !== index) : [...schedule.days, index].sort() })}
                    className={cn("h-8 w-11 rounded-md border text-xs", schedule.days.includes(index) ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-accent")}
                  >
                    {day}
                  </button>
                ))}
              </div>
            ) : null}
            <Field label="Time zone" htmlFor="schedule-zone" hint={describeSchedule(schedule)}>
              <Input id="schedule-zone" value={schedule.timezone} onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })} placeholder={zone} />
            </Field>
          </div>
        ) : null}

        {trigger.type === "webhook" ? (
          <div className="space-y-2 rounded-md border border-border p-3 text-sm">
            {unsaved ? (
              <p className="text-muted-foreground">Save this automation first, then create its address.</p>
            ) : webhookUrl ? (
              <>
                <p className="text-warning">Copy this address now. For safety it can&apos;t be shown again.</p>
                <div className="flex gap-2">
                  <Input readOnly aria-label="Webhook address" value={webhookUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                  <Button variant="outline" onClick={onCopy}>
                    {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Send a POST request with a JSON body. Its fields are available as {"{{trigger.fieldName}}"}, and the raw body as {"{{trigger.body}}"}.</p>
                <pre className="overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-xs">{`curl -X POST '${webhookUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"title": "Buy milk"}'`}</pre>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-muted-foreground">{hasWebhook ? "An address exists, but it can only be shown when it's created. Make a new one to replace it; the old one stops working." : "No address yet."}</p>
                <Button variant="outline" onClick={onCreateAddress}>
                  {hasWebhook ? "Make a new address" : "Create address"}
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {info.fields.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Available to steps: {info.fields.map((field) => (/^\w+$/.test(field) ? `{{trigger.${field}}}` : field)).join(", ")}
          </p>
        ) : null}
      </div>
    </article>
  );
}
