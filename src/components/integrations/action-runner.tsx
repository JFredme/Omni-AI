"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { actionsFor, PROVIDER_INFO, type ActionInfo, type Provider } from "@/lib/integrations/catalog";

/** Try the actions of a connected service. Reading just runs; anything that changes something outside Omni asks first. */
export function ActionRunner({ provider }: { provider: Provider }) {
  const actions = actionsFor(provider);
  const [actionId, setActionId] = useState(actions[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const action = actions.find((candidate) => candidate.id === actionId) ?? actions[0];
  if (!action) return null;

  const missing = action.fields.filter((field) => field.required && !(values[field.name] ?? "").trim());

  async function run(confirm: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiRequest<{ result: unknown }>("/api/integrations/actions", { json: { action: action.id, params: values, confirm } });
      setResult(data.result ?? { done: true });
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "That didn't work.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4" aria-label={`Try ${PROVIDER_INFO[provider].label}`}>
      <Field label="Try an action" htmlFor={`action-${provider}`} hint={action.description}>
        <Select id={`action-${provider}`} value={action.id} onChange={(e) => { setActionId(e.target.value); setValues({}); setResult(null); setError(null); }}>
          {actions.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}{candidate.risk === "write" ? " (changes something)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {action.fields.map((field) => (
        <Field key={field.name} label={field.label} htmlFor={`${action.id}-${field.name}`} hint={field.hint}>
          {field.kind === "textarea" ? (
            <Textarea id={`${action.id}-${field.name}`} rows={3} value={values[field.name] ?? ""} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} />
          ) : field.kind === "select" ? (
            <Select id={`${action.id}-${field.name}`} value={values[field.name] ?? field.options?.[0]?.value ?? ""} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}>
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input id={`${action.id}-${field.name}`} type={field.kind === "number" ? "number" : "text"} placeholder={field.placeholder} value={values[field.name] ?? ""} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} />
          )}
        </Field>
      ))}
      <Button variant={action.risk === "write" ? "primary" : "outline"} disabled={busy || missing.length > 0} onClick={() => (action.risk === "write" ? setConfirming(true) : void run(false))}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />} {action.risk === "write" ? "Review and send…" : "Run"}
      </Button>
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {result !== null ? (
        <pre aria-label="Result" className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs">
          {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
        </pre>
      ) : null}

      {confirming ? <ConfirmDialog action={action} values={values} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void run(true)} /> : null}
    </div>
  );
}

function ConfirmDialog({ action, values, busy, onCancel, onConfirm }: { action: ActionInfo; values: Record<string, string>; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog
      title={`Send to ${PROVIDER_INFO[action.provider].label}?`}
      description={action.description}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Sending…" : action.label}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm font-medium">This is exactly what will be sent:</p>
      <dl className="space-y-2 text-sm">
        {action.fields.map((field) => (
          <div key={field.name}>
            <dt className="eyebrow">{field.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-xs">{values[field.name] || "(empty)"}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
