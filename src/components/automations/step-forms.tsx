"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CONDITION_OPERATORS, EVENT_RANGES, HTTP_METHODS, TASK_FILTERS, TRIGGER_INFO, type Step, type Trigger } from "@/lib/automations/types";

const FILTER_LABELS: Record<(typeof TASK_FILTERS)[number], string> = {
  due_today: "Due today",
  overdue: "Overdue",
  due_this_week: "Due in the next 7 days",
  open: "All open tasks",
  high_priority: "High and urgent priority",
};
const RANGE_LABELS: Record<(typeof EVENT_RANGES)[number], string> = { today: "Today", tomorrow: "Tomorrow", next_7_days: "The next 7 days" };
const OPERATOR_LABELS: Record<(typeof CONDITION_OPERATORS)[number], string> = {
  contains: "contains",
  not_contains: "doesn't contain",
  equals: "equals",
  not_empty: "isn't empty",
  empty: "is empty",
};

/** The values a step can use: what started the run, and what earlier steps produced. */
export function availablePlaceholders(trigger: Trigger, steps: Step[], index: number): string[] {
  const fromTrigger = TRIGGER_INFO[trigger.type].fields.filter((field) => /^\w+$/.test(field)).map((field) => `trigger.${field}`);
  const fromSteps = steps
    .slice(0, index)
    .map((step, i) => (step.type === "condition" ? null : `steps.${i + 1}.output`))
    .filter((value): value is string => value !== null);
  return [...fromTrigger, ...fromSteps, "today", "now"];
}

/** A text box that can have a {{placeholder}} added from a list, so nobody has to remember the syntax. */
function TemplateField({
  label,
  id,
  value,
  onChange,
  placeholders,
  multiline = false,
  hint,
  rows = 4,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholders: string[];
  multiline?: boolean;
  hint?: string;
  rows?: number;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {multiline ? <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} /> : <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />}
      <Select
        aria-label={`Insert a value into ${label}`}
        value=""
        onChange={(e) => {
          if (e.target.value) onChange(`${value}{{${e.target.value}}}`);
        }}
        className="mt-1.5 h-8 w-auto max-w-full text-xs text-muted-foreground"
      >
        <option value="">Insert a value…</option>
        {placeholders.map((path) => (
          <option key={path} value={path}>
            {`{{${path}}}`}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function StepForm({ step, index, trigger, steps, onChange, zone }: { step: Step; index: number; trigger: Trigger; steps: Step[]; onChange: (step: Step) => void; zone: string }) {
  const placeholders = availablePlaceholders(trigger, steps, index);
  const id = (name: string) => `step-${step.id}-${name}`;

  switch (step.type) {
    case "fetch_tasks":
      return (
        <Field label="Which tasks" htmlFor={id("filter")} hint="The list is passed to later steps as text.">
          <Select id={id("filter")} value={step.filter} onChange={(e) => onChange({ ...step, filter: e.target.value as typeof step.filter })}>
            {TASK_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {FILTER_LABELS[filter]}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "fetch_events":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Which events" htmlFor={id("range")}>
            <Select id={id("range")} value={step.range} onChange={(e) => onChange({ ...step, range: e.target.value as typeof step.range })}>
              {EVENT_RANGES.map((range) => (
                <option key={range} value={range}>
                  {RANGE_LABELS[range]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time zone" htmlFor={id("tz")}>
            <Input id={id("tz")} value={step.timezone} onChange={(e) => onChange({ ...step, timezone: e.target.value })} placeholder={zone} />
          </Field>
        </div>
      );
    case "ai_prompt":
      return (
        <div className="space-y-3">
          <TemplateField label="Prompt" id={id("prompt")} value={step.prompt} onChange={(prompt) => onChange({ ...step, prompt })} placeholders={placeholders} multiline rows={6} hint="Sent to your default model. Its reply becomes this step's output." />
          <TemplateField label="Instructions for the model (optional)" id={id("system")} value={step.system} onChange={(system) => onChange({ ...step, system })} placeholders={placeholders} multiline rows={2} />
        </div>
      );
    case "create_task":
      return (
        <div className="space-y-3">
          <TemplateField label="Title" id={id("title")} value={step.title} onChange={(title) => onChange({ ...step, title })} placeholders={placeholders} />
          <TemplateField label="Description" id={id("description")} value={step.description} onChange={(description) => onChange({ ...step, description })} placeholders={placeholders} multiline rows={2} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Priority" htmlFor={id("priority")}>
              <Select id={id("priority")} value={step.priority} onChange={(e) => onChange({ ...step, priority: e.target.value as typeof step.priority })}>
                {["low", "medium", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due" htmlFor={id("due")}>
              <Select id={id("due")} value={step.dueInDays === null ? "none" : String(step.dueInDays)} onChange={(e) => onChange({ ...step, dueInDays: e.target.value === "none" ? null : Number(e.target.value) })}>
                <option value="none">No due date</option>
                <option value="0">Today</option>
                <option value="1">Tomorrow</option>
                <option value="7">In a week</option>
                <option value="30">In 30 days</option>
              </Select>
            </Field>
            <Field label="Tags" htmlFor={id("tags")} hint="Separated by commas.">
              <Input id={id("tags")} value={step.tags} onChange={(e) => onChange({ ...step, tags: e.target.value })} />
            </Field>
          </div>
        </div>
      );
    case "create_note":
      return (
        <div className="space-y-3">
          <TemplateField label="Title" id={id("title")} value={step.title} onChange={(title) => onChange({ ...step, title })} placeholders={placeholders} />
          <TemplateField label="Content (Markdown)" id={id("content")} value={step.content} onChange={(content) => onChange({ ...step, content })} placeholders={placeholders} multiline rows={5} />
        </div>
      );
    case "create_event":
      return (
        <div className="space-y-3">
          <TemplateField label="Title" id={id("title")} value={step.title} onChange={(title) => onChange({ ...step, title })} placeholders={placeholders} />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Day" htmlFor={id("day")}>
              <Select id={id("day")} value={step.day} onChange={(e) => onChange({ ...step, day: e.target.value as typeof step.day })}>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
              </Select>
            </Field>
            <Field label="Starts at" htmlFor={id("time")}>
              <Input id={id("time")} type="time" value={step.time} onChange={(e) => onChange({ ...step, time: e.target.value })} />
            </Field>
            <Field label="Minutes" htmlFor={id("minutes")}>
              <Input id={id("minutes")} type="number" min={5} max={1440} value={step.durationMinutes} onChange={(e) => onChange({ ...step, durationMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Time zone" htmlFor={id("tz")}>
              <Input id={id("tz")} value={step.timezone} onChange={(e) => onChange({ ...step, timezone: e.target.value })} placeholder={zone} />
            </Field>
          </div>
        </div>
      );
    case "http_request":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label="Method" htmlFor={id("method")}>
              <Select id={id("method")} value={step.method} onChange={(e) => onChange({ ...step, method: e.target.value as typeof step.method })}>
                {HTTP_METHODS.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </Select>
            </Field>
            <TemplateField label="Address" id={id("url")} value={step.url} onChange={(url) => onChange({ ...step, url })} placeholders={placeholders} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Headers</p>
            {step.headers.map((header, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label="Header name" value={header.name} onChange={(e) => onChange({ ...step, headers: step.headers.map((h, j) => (j === i ? { ...h, name: e.target.value } : h)) })} placeholder="Authorization" className="w-40" />
                <Input aria-label="Header value" value={header.value} onChange={(e) => onChange({ ...step, headers: step.headers.map((h, j) => (j === i ? { ...h, value: e.target.value } : h)) })} placeholder="Bearer …" />
                <Button size="icon" variant="ghost" aria-label="Remove header" onClick={() => onChange({ ...step, headers: step.headers.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            {step.headers.length < 8 ? (
              <Button size="sm" variant="outline" onClick={() => onChange({ ...step, headers: [...step.headers, { name: "", value: "" }] })}>
                <Plus className="size-3.5" aria-hidden /> Add header
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">Header values are saved in your database and masked in run history.</p>
          </div>
          {step.method !== "GET" ? <TemplateField label="Body" id={id("body")} value={step.body} onChange={(body) => onChange({ ...step, body })} placeholders={placeholders} multiline rows={4} /> : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--primary)]" checked={step.failOnError} onChange={(e) => onChange({ ...step, failOnError: e.target.checked })} />
            Treat an error response (like 404 or 500) as a failure
          </label>
        </div>
      );
    case "condition":
      return (
        <div className="space-y-3">
          <TemplateField label="Check this value" id={id("value")} value={step.value} onChange={(value) => onChange({ ...step, value })} placeholders={placeholders} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="It" htmlFor={id("operator")}>
              <Select id={id("operator")} value={step.operator} onChange={(e) => onChange({ ...step, operator: e.target.value as typeof step.operator })}>
                {CONDITION_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {OPERATOR_LABELS[operator]}
                  </option>
                ))}
              </Select>
            </Field>
            {step.operator === "contains" || step.operator === "not_contains" || step.operator === "equals" ? (
              <TemplateField label="This text" id={id("compare")} value={step.compare} onChange={(compare) => onChange({ ...step, compare })} placeholders={placeholders} />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">If this isn&apos;t true, the automation stops here without an error and the steps after it are skipped. Matching ignores upper and lower case.</p>
        </div>
      );
  }
}
