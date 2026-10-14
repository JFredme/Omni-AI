import { runAiText } from "@/lib/ai/run";
import { createEvent } from "@/lib/calendar/service";
import { createEventSchema } from "@/lib/calendar/schemas";
import { zonedParts, zonedToUtc } from "@/lib/calendar/tz";
import { listRange } from "@/lib/calendar/service";
import { addDays } from "@/lib/dates";
import { createNote } from "@/lib/notes/service";
import { normalizeTags } from "@/lib/tags";
import { createTask, listTasks } from "@/lib/tasks/service";
import { assertPublicUrl, BlockedUrlError } from "./ssrf";
import { runIntegrationAction } from "@/lib/integrations/actions";
import { renderTemplate, type TemplateContext } from "./template";
import type { Step } from "./types";

export interface StepResult {
  /** What the step was given, after placeholders were filled in. Secrets are masked. */
  input: unknown;
  output: unknown;
  /** True when a condition said to stop; the run ends as "skipped". */
  stop?: boolean;
}

const MAX_HTTP_BODY = 4_000;
const HTTP_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

const priorityLabel = (priority: string) => (priority === "medium" ? "" : `[${priority}] `);

async function fetchTasksStep(step: Extract<Step, { type: "fetch_tasks" }>, context: TemplateContext): Promise<StepResult> {
  const today = context.today;
  const all = await listTasks(step.filter === "due_today" ? { due: "today" } : step.filter === "overdue" ? { due: "overdue" } : step.filter === "due_this_week" ? { due: "week" } : {}, today);
  const open = all.filter((task) => task.status !== "done");
  const picked = (step.filter === "high_priority" ? open.filter((task) => task.priority === "high" || task.priority === "urgent") : open).slice(0, 50);
  const lines = picked.map((task) => `- ${priorityLabel(task.priority)}${task.title}${task.dueDate ? ` (due ${task.dueDate})` : ""}${task.projectName ? ` · ${task.projectName}` : ""}`);
  return { input: { filter: step.filter }, output: lines.length ? lines.join("\n") : "(no tasks)" };
}

async function fetchEventsStep(step: Extract<Step, { type: "fetch_events" }>, context: TemplateContext): Promise<StepResult> {
  const first = step.range === "tomorrow" ? addDays(context.today, 1) : context.today;
  const days = step.range === "next_7_days" ? 7 : 1;
  const at = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return zonedToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, step.timezone);
  };
  const { occurrences } = await listRange(at(first), at(addDays(first, days)));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: step.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const lines = occurrences.slice(0, 50).map((o) => {
    const day = zonedParts(new Date(o.start), step.timezone);
    const date = `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
    const when = o.allDay ? "all day" : `${time.format(new Date(o.start))}–${time.format(new Date(o.end))}`;
    return `- ${days > 1 ? `${date} ` : ""}${when} ${o.title}${o.location ? ` @ ${o.location}` : ""}`;
  });
  return { input: { range: step.range, timezone: step.timezone }, output: lines.length ? lines.join("\n") : "(no events)" };
}

async function httpStep(step: Extract<Step, { type: "http_request" }>, context: TemplateContext, signal: AbortSignal): Promise<StepResult> {
  let url = await assertPublicUrl(renderTemplate(step.url, context));
  const headers = new Headers();
  for (const header of step.headers) headers.set(header.name, renderTemplate(header.value, context));
  const hasBody = step.method !== "GET" && step.body.trim() !== "";
  const body = hasBody ? renderTemplate(step.body, context) : undefined;
  if (hasBody && !headers.has("content-type")) headers.set("content-type", /^\s*[{[]/.test(body ?? "") ? "application/json" : "text/plain");
  const maskedInput = { method: step.method, url: url.toString(), headers: step.headers.map((header) => ({ name: header.name, value: "•••" })), body };

  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await fetch(url, { method: step.method, headers, body: hop === 0 ? body : undefined, redirect: "manual", signal: combined });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      // Every hop is checked again, so a redirect can't lead somewhere that was blocked up front.
      try {
        url = await assertPublicUrl(new URL(location, url).toString());
      } catch (error) {
        if (error instanceof BlockedUrlError) throw new BlockedUrlError(`A redirect pointed somewhere that is blocked. ${error.message}`);
        throw error;
      }
      continue;
    }
    break;
  }
  if (!response) throw new Error("No response.");
  const raw = await response.text();
  const output = { status: response.status, ok: response.ok, body: raw.length > MAX_HTTP_BODY ? `${raw.slice(0, MAX_HTTP_BODY)}…` : raw };
  if (!response.ok && step.failOnError) throw Object.assign(new Error(`The service answered with HTTP ${response.status}.`), { output, input: maskedInput });
  return { input: maskedInput, output };
}

function evaluateCondition(step: Extract<Step, { type: "condition" }>, context: TemplateContext): { value: string; compare: string; passed: boolean } {
  const value = renderTemplate(step.value, context).trim();
  const compare = renderTemplate(step.compare, context).trim();
  const lower = value.toLowerCase();
  const passed =
    step.operator === "contains" ? lower.includes(compare.toLowerCase()) :
    step.operator === "not_contains" ? !lower.includes(compare.toLowerCase()) :
    step.operator === "equals" ? lower === compare.toLowerCase() :
    step.operator === "not_empty" ? value !== "" :
    value === "";
  return { value, compare, passed };
}

/** Runs one step. Throws with a plain-language message on failure. */
export async function executeStep(step: Step, context: TemplateContext, signal: AbortSignal): Promise<StepResult> {
  switch (step.type) {
    case "fetch_tasks":
      return fetchTasksStep(step, context);
    case "fetch_events":
      return fetchEventsStep(step, context);
    case "ai_prompt": {
      const prompt = renderTemplate(step.prompt, context);
      const system = renderTemplate(step.system, context);
      const { text } = await runAiText({ system: system || undefined, user: prompt, signal });
      return { input: { prompt, ...(system ? { system } : {}) }, output: text };
    }
    case "create_task": {
      const title = renderTemplate(step.title, context).trim().slice(0, 200);
      if (!title) throw new Error("The task's title was empty after filling in the placeholders.");
      const task = await createTask({
        title,
        description: renderTemplate(step.description, context).slice(0, 10_000),
        priority: step.priority,
        dueDate: step.dueInDays === null ? undefined : addDays(context.today, step.dueInDays),
        tags: normalizeTags(renderTemplate(step.tags, context).split(",").map((tag) => tag.trim()).filter(Boolean)),
      });
      return { input: { title, priority: step.priority, dueInDays: step.dueInDays }, output: { id: task.id, title: task.title } };
    }
    case "create_note": {
      const title = renderTemplate(step.title, context).trim().slice(0, 200);
      const content = renderTemplate(step.content, context);
      if (!title && !content.trim()) throw new Error("The note was empty after filling in the placeholders.");
      const note = await createNote({ title, content });
      return { input: { title, characters: content.length }, output: { id: note.id, title: note.title } };
    }
    case "create_event": {
      const day = step.day === "tomorrow" ? addDays(context.today, 1) : context.today;
      const [year, month, date] = day.split("-").map(Number);
      const [hour, minute] = step.time.split(":").map(Number);
      const start = zonedToUtc({ year, month, day: date, hour, minute, second: 0 }, step.timezone);
      const title = renderTemplate(step.title, context).trim().slice(0, 200);
      if (!title) throw new Error("The event's title was empty after filling in the placeholders.");
      const event = await createEvent(createEventSchema.parse({ title, start: start.toISOString(), end: new Date(start.getTime() + step.durationMinutes * 60_000).toISOString(), timezone: step.timezone }));
      return { input: { title, start: event.startsAt, end: event.endsAt }, output: { id: event.id, title: event.title } };
    }
    case "http_request":
      return httpStep(step, context, signal);
    case "integration": {
      const params = Object.fromEntries(Object.entries(step.params).map(([name, value]) => [name, renderTemplate(value, context)]));
      const output = await runIntegrationAction(step.action, params, signal);
      return { input: { action: step.action, params }, output };
    }
    case "condition": {
      const result = evaluateCondition(step, context);
      return { input: { value: result.value, operator: step.operator, compare: result.compare }, output: result.passed, stop: !result.passed };
    }
  }
}
