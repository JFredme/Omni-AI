"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { safeNextPath } from "@/lib/auth/guard";

type Mode = "loading" | "setup" | "login";

export function LoginForm() {
  const next = safeNextPath(useSearchParams().get("next"));
  const [mode, setMode] = useState<Mode>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ configured: boolean; authenticated: boolean }>("/api/auth/status")
      .then((status) => {
        if (cancelled) return;
        if (status.authenticated) window.location.replace(next);
        else setMode(status.configured ? "login" : "setup");
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof ClientApiError ? caught.message : "Couldn't reach the server.");
        setMode("login");
      });
    return () => {
      cancelled = true;
    };
  }, [next]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (mode === "setup" && password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", { json: { password } });
      window.location.assign(next);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const setup = mode === "setup";

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" className="size-7 text-primary" aria-hidden>
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="12" cy="12" r="3.6" fill="currentColor" />
        </svg>
        <span className="font-display text-2xl font-medium">Omni</span>
      </div>

      <h1 className="font-display text-3xl font-medium leading-tight">{mode === "loading" ? " " : setup ? "Set a password" : "Welcome back"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {setup
          ? "This is your own copy of Omni. Choose a password to keep it private. You'll use it to sign in from now on."
          : mode === "login"
            ? "Enter your password to open your workspace."
            : ""}
      </p>

      {mode !== "loading" ? (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Password" htmlFor="password" hint={setup ? "At least 10 characters." : undefined}>
            <Input
              id="password"
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
            />
          </Field>
          {setup ? (
            <Field label="Confirm password" htmlFor="confirm">
              <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
            </Field>
          ) : null}
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !password}>
            {busy ? "One moment…" : setup ? "Create password" : "Sign in"}
          </Button>
        </form>
      ) : error ? (
        <ErrorBanner message={error} className="mt-6" />
      ) : null}

      {setup ? (
        <p className="mt-6 text-xs text-muted-foreground">
          There is no way to reset this by email. If you forget it, you can clear the AuthConfig table in your database and set a new one.
        </p>
      ) : null}
    </div>
  );
}
