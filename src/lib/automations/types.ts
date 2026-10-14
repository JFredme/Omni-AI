// Client-safe automation types and the catalog the editor builds its forms from.
import type { ScheduleSpec } from "./schedule";

export type { ScheduleSpec };

export const TRIGGER_TYPES = ["manual", "schedule", "task_created", "task_completed", "note_created", "document_added", "webhook"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export type Trigger = { type: "schedule"; schedule: ScheduleSpec } | { type: Exclude<TriggerType, "schedule"> };

export const TRIGGER_INFO: Record<TriggerType, { label: string; description: string; fields: string[] }> = {
  manual: { label: "When I press Run", description: "Only runs when you start it yourself.", fields: [] },
  schedule: { label: "On a schedule", description: "Runs every few minutes, daily, or on chosen days of the week.", fields: ["scheduledFor"] },
  task_created: { label: "When a task is created", description: "Runs for every new task you or an agent create.", fields: ["id", "title", "description", "priority", "dueDate", "tags"] },
  task_completed: { label: "When a task is completed", description: "Runs when a task's status changes to Done.", fields: ["id", "title", "description", "priority", "dueDate", "tags"] },
  note_created: { label: "When a note is created", description: "Runs for every new note.", fields: ["id", "title", "content", "tags"] },
  document_added: { label: "When a document is added to Knowledge", description: "Runs when a file, pasted text, or note is added.", fields: ["id", "name", "kind"] },
  webhook: { label: "When a web address is called", description: "Gives you a private URL. Anything that can send a web request can start this automation.", fields: ["body", "(any field of the JSON you send)"] },
};

export const STEP_TYPES = ["fetch_tasks", "fetch_events", "ai_prompt", "create_task", "create_note", "create_event", "http_request", "integration", "condition"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const TASK_FILTERS = ["due_today", "overdue", "due_this_week", "open", "high_priority"] as const;
export const EVENT_RANGES = ["today", "tomorrow", "next_7_days"] as const;
export const CONDITION_OPERATORS = ["contains", "not_contains", "equals", "not_empty", "empty"] as const;
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Base = { id: string };
export type Step =
  | (Base & { type: "fetch_tasks"; filter: (typeof TASK_FILTERS)[number] })
  | (Base & { type: "fetch_events"; range: (typeof EVENT_RANGES)[number]; timezone: string })
  | (Base & { type: "ai_prompt"; prompt: string; system: string })
  | (Base & { type: "create_task"; title: string; description: string; priority: "low" | "medium" | "high" | "urgent"; dueInDays: number | null; tags: string })
  | (Base & { type: "create_note"; title: string; content: string })
  | (Base & { type: "create_event"; title: string; day: "today" | "tomorrow"; time: string; durationMinutes: number; timezone: string })
  | (Base & { type: "http_request"; method: (typeof HTTP_METHODS)[number]; url: string; headers: { name: string; value: string }[]; body: string; failOnError: boolean })
  | (Base & { type: "integration"; action: string; params: Record<string, string> })
  | (Base & { type: "condition"; value: string; operator: (typeof CONDITION_OPERATORS)[number]; compare: string });

export const STEP_INFO: Record<StepType, { label: string; description: string; kind: "read" | "write" | "ai" | "external" | "logic" }> = {
  fetch_tasks: { label: "Look up tasks", description: "Gets a list of your tasks as text for later steps.", kind: "read" },
  fetch_events: { label: "Look up calendar events", description: "Gets your upcoming events as text for later steps.", kind: "read" },
  ai_prompt: { label: "Ask the AI", description: "Sends a prompt to your default model and keeps its reply. Costs money.", kind: "ai" },
  create_task: { label: "Create a task", description: "Adds a task.", kind: "write" },
  create_note: { label: "Create a note", description: "Adds a Markdown note.", kind: "write" },
  create_event: { label: "Add a calendar event", description: "Adds an event today or tomorrow.", kind: "write" },
  http_request: { label: "Call a web address", description: "Sends a request to another service. Addresses on your own network are blocked.", kind: "external" },
  integration: { label: "Use a connected service", description: "Runs an action on GitHub, Notion, Todoist, Slack, Discord, or Google, using what you connected in Integrations.", kind: "external" },
  condition: { label: "Only continue if…", description: "Stops the automation quietly unless a condition is true.", kind: "logic" },
};

export const MAX_STEPS = 12;

export interface WorkflowDto {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: Trigger;
  steps: Step[];
  nextRunAt: string | null;
  lastRunAt: string | null;
  hasWebhook: boolean;
  lastRunStatus: RunStatus | null;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = "running" | "succeeded" | "failed" | "skipped";

export interface RunStepDto {
  id: string;
  index: number;
  type: StepType;
  status: "running" | "ok" | "error" | "skipped";
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RunDto {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: RunStatus;
  triggerType: TriggerType;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps: RunStepDto[];
}
