"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { useLoginRequired } from "@/lib/client/login-required";
import { formatRelativeDate } from "@/lib/format";

interface SessionRow {
  id: string;
  userAgent: string | null;
  lastUsedAt: string;
  current: boolean;
}

interface AuditEntry {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

function describeAgent(agent: string | null): string {
  if (!agent) return "Unknown browser";
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /Mac OS X/.test(agent) ? "macOS" : /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}

function SecurityCardOn() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        apiRequest<{ sessions: SessionRow[] }>("/api/auth/sessions"),
        apiRequest<{ entries: AuditEntry[] }>("/api/audit?limit=15"),
      ]);
      setSessions(s.sessions);
      setEntries(a.entries);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't load security details.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ signedOutOtherBrowsers: number }>("/api/auth/password", { json: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setMessage(result.signedOutOtherBrowsers > 0 ? `Password changed. ${result.signedOutOtherBrowsers} other browser(s) were signed out.` : "Password changed.");
      await load();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutOthers() {
    setError(null);
    try {
      const result = await apiRequest<{ signedOut: number }>("/api/auth/sessions", { method: "DELETE" });
      setMessage(`Signed out ${result.signedOut} other browser(s).`);
      await load();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't sign the others out.");
    }
  }

  return (
    <Card className="space-y-6 lg:col-span-2">
      <div>
        <h2 className="font-semibold">Security</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your password protects every page and API route. Sessions last 30 days.</p>
      </div>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {message ? <p role="status" className="text-sm text-success">{message}</p> : null}

      <div className="grid gap-8 md:grid-cols-2">
        <form onSubmit={changePassword} className="space-y-3">
          <p className="eyebrow">Change password</p>
          <Field label="Current password" htmlFor="current-password">
            <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required />
          </Field>
          <Field label="New password" htmlFor="new-password" hint="At least 10 characters. Other browsers are signed out.">
            <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} required />
          </Field>
          <Button type="submit" variant="outline" disabled={busy || !current || !next}>
            Change password
          </Button>
        </form>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Signed-in browsers</p>
            {sessions && sessions.length > 1 ? (
              <button type="button" onClick={() => void signOutOthers()} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Sign out the others
              </button>
            ) : null}
          </div>
          {!sessions ? (
            <div className="h-10 animate-pulse rounded-md bg-muted" role="status" aria-label="Loading" />
          ) : (
            <ul className="divide-y divide-border border-y border-border text-sm">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span>
                    {describeAgent(session.userAgent)}
                    {session.current ? <span className="ml-2 text-xs text-primary">this browser</span> : null}
                  </span>
                  <span className="num text-xs text-muted-foreground">{formatRelativeDate(session.lastUsedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="eyebrow">Recent activity</p>
        {!entries ? (
          <div className="h-10 animate-pulse rounded-md bg-muted" role="status" aria-label="Loading" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-muted-foreground">{entry.action}</span>
                  {entry.detail ? <span className="ml-2">{entry.detail}</span> : null}
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground">{formatRelativeDate(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function SecurityCard() {
  const required = useLoginRequired();
  if (required === null) return null;
  if (required) return <SecurityCardOn />;
  return (
    <Card>
      <h2 className="font-display text-xl">Sign-in is off</h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Anyone who can open this address can use the app, which is fine on your own computer. To require a password, set <code className="font-mono">OMNI_REQUIRE_LOGIN=1</code> in <code className="font-mono">.env</code> and restart. Do that before exposing the app to a network.
      </p>
    </Card>
  );
}
