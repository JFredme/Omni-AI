"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

/** The master switch for letting agents use this computer. Off by default; every action still asks first. */
export function ComputerCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ computerControl: boolean }>("/api/settings")
      .then((settings) => setEnabled(settings.computerControl))
      .catch(() => setEnabled(false));
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const settings = await apiRequest<{ computerControl: boolean }>("/api/settings", { method: "PATCH", json: { computerControl: next } });
      setEnabled(settings.computerControl);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't change that setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60 space-y-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <Monitor className="size-4" aria-hidden />
            Let agents use this computer
          </h2>
          <p className="text-sm text-muted-foreground">
            When this is on, the Computer Assistant agent (and any agent you give the tools to) can run commands, read and write files, and open apps
            and pages on this computer to get things done for you. Type <code className="font-mono">/do</code> followed by what you want in the chat.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label="Let agents use this computer"
          disabled={enabled === null || busy}
          onClick={() => void change(!enabled)}
          className={cn("relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50", enabled ? "border-primary bg-primary" : "border-border bg-muted")}
        >
          <span className={cn("absolute top-0.5 size-6 rounded-full bg-background shadow transition-all", enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          <strong className="text-foreground">Every action asks you first.</strong> You see the exact command or file change and choose Approve or Decline. There is no
          automatic mode.
        </li>
        <li>It can&apos;t use administrator rights, erase disks, shut the computer down, or touch secret files like keys and passwords.</li>
        <li>It only works on the computer OMNI is running on, and this switch can only be changed from that computer, not from a phone.</li>
        <li>Web pages and files an agent reads could try to trick it. Read each request before approving.</li>
      </ul>
      {error ? <ErrorBanner message={error} /> : null}
    </Card>
  );
}
