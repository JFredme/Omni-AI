export type IntegrationErrorKind = "rejected" | "forbidden" | "not_found" | "rate_limited" | "unavailable" | "bad_request" | "bad_response";

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly kind: IntegrationErrorKind,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Calls an outside service and reads a JSON (or empty) reply. Failures become plain-language errors, and neither the
 * address's credentials nor the service's raw error text is passed along as the message.
 */
export async function callService(service: string, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "error" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new IntegrationError(timeout.aborted ? `${service} took too long to answer.` : `${service} couldn't be reached.`, "unavailable");
  }
  if (response.status === 401) throw new IntegrationError(`${service} rejected the saved credentials. Reconnect it in Integrations.`, "rejected");
  if (response.status === 403) throw new IntegrationError(`${service} says this connection isn't allowed to do that. Check the permissions you gave it.`, "forbidden");
  if (response.status === 404) throw new IntegrationError(`${service} couldn't find what was asked for. Check the name or ID.`, "not_found");
  if (response.status === 429) throw new IntegrationError(`${service} says there have been too many requests. Try again in a moment.`, "rate_limited");
  if (response.status === 400 || response.status === 422) throw new IntegrationError(`${service} didn't accept that request. Check what you entered.`, "bad_request");
  if (!response.ok) throw new IntegrationError(`${service} answered with an error (HTTP ${response.status}).`, "unavailable");
  const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const trimText = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
