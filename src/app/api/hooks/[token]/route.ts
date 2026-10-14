import { runWorkflow } from "@/lib/automations/engine";
import { findByWebhookToken } from "@/lib/automations/service";
import { hit } from "@/lib/rate-limit";

type Context = { params: Promise<{ token: string }> };

const MAX_BODY_BYTES = 100 * 1024;

/**
 * Starts an automation from outside the app. The secret in the address is the only credential, so unknown or switched-off
 * addresses all answer the same way and nothing about the automation is revealed.
 */
export async function POST(request: Request, { params }: Context) {
  const { token } = await params;
  const limit = hit(`hook:${token.slice(0, 24)}`, 60, 60_000);
  if (!limit.allowed) {
    return Response.json({ error: { code: "rate_limited", message: "Too many requests." } }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const notFound = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return Response.json({ error: { code: "too_large", message: "The body is too large." } }, { status: 413 });
  const text = (await request.text()).slice(0, MAX_BODY_BYTES);

  const workflow = await findByWebhookToken(token);
  if (!workflow || !workflow.enabled) return notFound();

  let data: Record<string, unknown> = { body: text };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = { ...(parsed as Record<string, unknown>), body: text };
    else if (parsed !== undefined) data = { body: text, value: parsed };
  } catch {
    // Plain text is fine: it is available as {{trigger.body}}.
  }
  void runWorkflow(workflow.id, { type: "webhook", data }).catch((error) => console.error("A webhook automation failed to start:", error));
  return Response.json({ ok: true }, { status: 202 });
}
