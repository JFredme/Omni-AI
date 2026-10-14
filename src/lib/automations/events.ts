import { AsyncLocalStorage } from "node:async_hooks";

/** Set while an automation is running, so what it does can't start other automations (and so can't loop). */
export const automationContext = new AsyncLocalStorage<{ runId: string }>();

const holder = globalThis as { __omniPendingEvents?: Set<Promise<unknown>> };
/** Events that have been announced but not yet handed to the engine. Tests wait on these. */
export const pendingEvents: Set<Promise<unknown>> = (holder.__omniPendingEvents ??= new Set());

export type AppEventType = "task_created" | "task_completed" | "note_created" | "document_added";

/**
 * Tells the automation engine something happened. Never waits for it and never throws, so a problem in an automation
 * can't break the action that triggered it.
 */
export function emitAppEvent(type: AppEventType, payload: Record<string, unknown>): void {
  if (automationContext.getStore()) return;
  const handled = import("./engine")
    .then((engine) => engine.dispatchEvent(type, payload))
    .catch((error) => console.error(`Automations couldn't handle ${type}:`, error))
    .finally(() => pendingEvents.delete(handled));
  pendingEvents.add(handled);
}
