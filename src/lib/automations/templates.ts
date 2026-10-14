import type { Step, Trigger } from "./types";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  trigger: (timezone: string) => Trigger;
  steps: (timezone: string) => Step[];
}

let counter = 0;
export const newStepId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "morning-briefing",
    name: "Morning briefing",
    description: "Every weekday at 8:00, the AI reads your due tasks and today's events and writes you a short briefing note.",
    trigger: (timezone) => ({ type: "schedule", schedule: { frequency: "weekly", time: "08:00", days: [1, 2, 3, 4, 5], timezone } }),
    steps: (timezone) => [
      { id: newStepId(), type: "fetch_tasks", filter: "due_today" },
      { id: newStepId(), type: "fetch_events", range: "today", timezone },
      {
        id: newStepId(),
        type: "ai_prompt",
        system: "You write brief, practical morning briefings. Plain text, no preamble.",
        prompt: "Write a short briefing for {{today}} from this.\n\nTasks due today:\n{{steps.1.output}}\n\nToday's events:\n{{steps.2.output}}\n\nSuggest the order to do things in.",
      },
      { id: newStepId(), type: "create_note", title: "Briefing {{today}}", content: "{{steps.3.output}}" },
    ],
  },
  {
    id: "log-done",
    name: "Log finished tasks",
    description: "Whenever you complete a task, add a note recording what was done and when.",
    trigger: () => ({ type: "task_completed" }),
    steps: () => [{ id: newStepId(), type: "create_note", title: "Done: {{trigger.title}}", content: "Completed on {{today}}.\n\n{{trigger.description}}" }],
  },
  {
    id: "web-inbox",
    name: "Capture tasks from a web address",
    description: "Gives you a private URL. Send it a JSON body like {\"title\": \"Buy milk\"} from a shortcut or another service and it becomes a task.",
    trigger: () => ({ type: "webhook" }),
    steps: () => [{ id: newStepId(), type: "create_task", title: "{{trigger.title}}", description: "{{trigger.notes}}", priority: "medium", dueInDays: null, tags: "inbox" }],
  },
  {
    id: "weekly-review",
    name: "Friday weekly review reminder",
    description: "Every Friday at 16:00, add a task to do your weekly review.",
    trigger: (timezone) => ({ type: "schedule", schedule: { frequency: "weekly", time: "16:00", days: [5], timezone } }),
    steps: () => [{ id: newStepId(), type: "create_task", title: "Do the weekly review", description: "Look at what got done, what slipped, and plan next week.", priority: "medium", dueInDays: 0, tags: "review" }],
  },
];

export function blankStep(type: Step["type"], timezone: string): Step {
  const id = newStepId();
  switch (type) {
    case "fetch_tasks":
      return { id, type, filter: "due_today" };
    case "fetch_events":
      return { id, type, range: "today", timezone };
    case "ai_prompt":
      return { id, type, prompt: "", system: "" };
    case "create_task":
      return { id, type, title: "", description: "", priority: "medium", dueInDays: null, tags: "" };
    case "create_note":
      return { id, type, title: "", content: "" };
    case "create_event":
      return { id, type, title: "", day: "today", time: "09:00", durationMinutes: 30, timezone };
    case "http_request":
      return { id, type, method: "POST", url: "https://", headers: [], body: "", failOnError: true };
    case "condition":
      return { id, type, value: "", operator: "contains", compare: "" };
  }
}
