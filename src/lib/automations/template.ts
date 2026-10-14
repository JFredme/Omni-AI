/**
 * Step settings can contain {{placeholders}}: {{trigger.title}}, {{steps.2.output}}, {{today}}, {{now}}. They are filled
 * in with plain text substitution only; nothing inside a placeholder is ever evaluated as code.
 */

export interface TemplateContext {
  trigger: Record<string, unknown>;
  /** Results of earlier steps, keyed by position starting at "1". */
  steps: Record<string, { output: unknown }>;
  today: string;
  now: string;
}

export const MAX_RENDERED_CHARS = 50_000;

function lookup(context: TemplateContext, path: string): unknown {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  let value: unknown = context;
  for (const part of parts) {
    if (value === null || typeof value !== "object") return undefined;
    // Only own properties, so a placeholder can't reach into prototypes.
    if (!Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.join("\n");
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function renderTemplate(template: string, context: TemplateContext): string {
  const text = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => stringify(lookup(context, path)));
  return text.length > MAX_RENDERED_CHARS ? text.slice(0, MAX_RENDERED_CHARS) : text;
}

/** The placeholders a template uses, for validation and display. */
export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]);
}
