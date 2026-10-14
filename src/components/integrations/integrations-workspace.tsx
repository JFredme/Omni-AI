"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, Loader2 } from "lucide-react";
import { ActionRunner } from "@/components/integrations/action-runner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { GOOGLE_SCOPE_SETS, PROVIDERS, PROVIDER_INFO, type ConnectionDto, type Provider } from "@/lib/integrations/catalog";
import { formatRelativeDate } from "@/lib/format";

const message = (error: unknown, fallback: string) => (error instanceof ClientApiError ? error.message : fallback);

export function IntegrationsWorkspace() {
  const params = useSearchParams();
  const [connections, setConnections] = useState<ConnectionDto[] | null>(null);
  const [redirectUri, setRedirectUri] = useState("");
  const [error, setError] = useState<string | null>(params.get("error"));
  const [notice, setNotice] = useState<string | null>(params.get("connected") ? `Connected to ${PROVIDER_INFO[params.get("connected") as Provider]?.label ?? "the service"} as ${params.get("account") ?? "your account"}.` : null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<{ connections: ConnectionDto[]; googleRedirectUri: string }>("/api/integrations");
      setConnections(data.connections);
      setRedirectUri(data.googleRedirectUri);
    } catch (caught) {
      setError(message(caught, "Couldn't load your integrations."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Automation"
        title="Integrations"
        description="Connect other services so Omni, your agents, and your automations can use them. Each connection is checked with the service before it's shown as connected, credentials are stored encrypted, and anything that changes something outside Omni asks first."
      />
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}

      {!connections ? (
        <SkeletonRows count={3} />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {PROVIDERS.map((provider) => (
            <ProviderRow key={provider} connection={connections.find((c) => c.provider === provider)!} redirectUri={redirectUri} onChanged={load} onNotice={setNotice} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProviderRow({ connection, redirectUri, onChanged, onNotice, onError }: { connection: ConnectionDto; redirectUri: string; onChanged: () => Promise<void>; onNotice: (text: string | null) => void; onError: (text: string | null) => void }) {
  const info = PROVIDER_INFO[connection.provider];
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "test" | "disconnect">(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy("connect");
    onError(null);
    try {
      const result = await apiRequest<{ account: string; verified: boolean }>(`/api/integrations/${connection.provider}`, { method: "PUT", json: { secret } });
      setSecret("");
      setVerified(result.verified);
      onNotice(result.verified ? `Connected to ${info.label} as ${result.account}.` : `Saved the ${info.label} webhook. ${info.label} can't check it without posting, so your first message is the real test.`);
      await onChanged();
    } catch (caught) {
      onError(message(caught, "Couldn't connect."));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    onError(null);
    try {
      const result = await apiRequest<{ account: string }>(`/api/integrations/${connection.provider}/test`, { method: "POST", json: {} });
      onNotice(`${info.label} is working (${result.account}).`);
      await onChanged();
    } catch (caught) {
      onError(message(caught, "The test failed."));
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      await apiRequest(`/api/integrations/${connection.provider}`, { method: "DELETE" });
      setConfirmDisconnect(false);
      setOpen(false);
      onNotice(`Disconnected ${info.label}. Its saved credentials were deleted.`);
      await onChanged();
    } catch (caught) {
      onError(message(caught, "Couldn't disconnect."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="py-5" aria-label={info.label}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{info.label}</h2>
            {connection.connected ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3" aria-hidden /> Connected{connection.account ? ` · ${connection.account}` : ""}
              </Badge>
            ) : (
              <Badge>
                <Circle className="size-3" aria-hidden /> Not connected
              </Badge>
            )}
            {connection.connected && verified === false ? <Badge tone="accent">Not verified</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{info.summary}</p>
          {connection.connected && connection.lastUsedAt ? <p className="num mt-1 text-xs text-muted-foreground">Last used {formatRelativeDate(connection.lastUsedAt)}</p> : null}
          {connection.connected && connection.lastError ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              Last problem: {connection.lastError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {connection.connected ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
                {open ? "Hide actions" : "Try it"}
              </Button>
              {connection.provider !== "slack" ? (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void test()}>
                  {busy === "test" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null} Test
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" className="text-danger" disabled={busy !== null} onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            </>
          ) : info.auth === "oauth" ? (
            connection.configured ? (
              <>
                {(Object.keys(GOOGLE_SCOPE_SETS) as (keyof typeof GOOGLE_SCOPE_SETS)[]).map((key) => (
                  <a key={key} href={`/api/integrations/google/start?scope=${key}`} className="inline-flex h-8 items-center rounded-lg border border-input bg-card px-3 text-sm font-medium hover:bg-accent">
                    Connect: {GOOGLE_SCOPE_SETS[key].label.toLowerCase()}
                  </a>
                ))}
              </>
            ) : null
          ) : null}
        </div>
      </div>

      {!connection.connected && info.auth !== "oauth" ? (
        <form onSubmit={connect} className="mt-3 max-w-xl space-y-2">
          <Field label={info.secretLabel ?? "Secret"} htmlFor={`secret-${connection.provider}`} hint={info.secretHint}>
            <Input id={`secret-${connection.provider}`} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={busy !== null || !secret.trim()}>
              {busy === "connect" ? "Checking…" : "Connect"}
            </Button>
            <a href={info.helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
              Where do I find this? <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </form>
      ) : null}

      {!connection.connected && info.auth === "oauth" && !connection.configured ? (
        <div role="note" className="mt-3 max-w-2xl space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p>
            <strong className="font-medium">Google sign-in isn&apos;t set up on this server yet.</strong> Google only lets an app you control sign you in, so this takes a few minutes, once:
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-xs">
            <li>
              In the <a className="underline" href={info.helpUrl} target="_blank" rel="noopener noreferrer">Google Cloud console</a>, create an <em>OAuth client ID</em> of type <em>Web application</em>, and turn on the Gmail, Google Calendar, and Google Drive APIs.
            </li>
            <li>
              Add this as an authorized redirect URI: <code className="font-mono">{redirectUri}</code>
            </li>
            <li>
              Put the client ID and secret in your <code className="font-mono">.env</code> as <code className="font-mono">GOOGLE_CLIENT_ID</code> and <code className="font-mono">GOOGLE_CLIENT_SECRET</code>, then restart Omni.
            </li>
          </ol>
        </div>
      ) : null}

      {connection.connected && open ? <ActionRunner provider={connection.provider} /> : null}

      {confirmDisconnect ? (
        <Dialog
          title={`Disconnect ${info.label}?`}
          description="Its saved credentials are deleted from your database. Automations and agents that use it will stop working until you connect it again. Nothing in the service itself is changed."
          onClose={() => setConfirmDisconnect(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
              <Button variant="primary" className="bg-danger hover:bg-danger/90" disabled={busy !== null} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">You can also revoke Omni&apos;s access from the service&apos;s own settings.</p>
        </Dialog>
      ) : null}
    </li>
  );
}
