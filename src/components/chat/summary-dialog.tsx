"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";

interface Summary {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  modelId: string;
  truncated: boolean;
}

function toMarkdown(title: string, result: Summary): string {
  return [
    result.summary,
    ...(result.keyPoints.length ? ["", "## Key points", ...result.keyPoints.map((point) => `- ${point}`)] : []),
    ...(result.actionItems.length ? ["", "## Action items", ...result.actionItems.map((item) => `- [ ] ${item}`)] : []),
    "",
    `*Summary of the chat "${title}", written by ${result.modelId}.*`,
  ].join("\n");
}

/** Asks the model for a summary of the visible branch. Nothing is saved until you choose to save it. */
export function SummaryDialog({ conversationId, title, onClose }: { conversationId: string; title: string; onClose: () => void }) {
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [tasksAdded, setTasksAdded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ summary: Summary }>(`/api/conversations/${conversationId}/summarize`, { json: {}, signal: controller.signal })
      .then(({ summary }) => {
        setResult(summary);
        setChecked(new Set(summary.actionItems.map((_, index) => index)));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof ClientApiError ? caught.message : "Couldn't summarize this chat.");
      });
    return () => controller.abort();
  }, [conversationId]);

  async function saveNote() {
    if (!result) return;
    setBusy(true);
    try {
      const { note } = await apiRequest<{ note: { id: string } }>("/api/notes", { json: { title: `Summary: ${title}`.slice(0, 200), content: toMarkdown(title, result) } });
      setSavedNote(note.id);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save the note.");
    } finally {
      setBusy(false);
    }
  }

  async function addTasks() {
    if (!result) return;
    setBusy(true);
    try {
      const items = result.actionItems.filter((_, index) => checked.has(index));
      for (const item of items) await apiRequest("/api/tasks", { json: { title: item.slice(0, 200), tags: ["from-chat"] } });
      setTasksAdded(items.length);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't add the tasks.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Summary of this chat"
      description="Written by the model from the version of the conversation you're viewing."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void saveNote()} disabled={!result || busy || savedNote !== null}>
            {savedNote ? "Saved as a note" : "Save as note"}
          </Button>
        </>
      }
    >
      {!result && !error ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the conversation…
        </p>
      ) : null}
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {result ? (
        <div className="space-y-4 text-sm">
          {result.truncated ? <p className="text-xs text-warning">This chat was long, so only its most recent part was summarized.</p> : null}
          <p className="leading-6">{result.summary}</p>
          {result.keyPoints.length ? (
            <div>
              <p className="eyebrow mb-1">Key points</p>
              <ul className="list-disc space-y-1 pl-5">
                {result.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.actionItems.length ? (
            <div>
              <p className="eyebrow mb-1">Action items</p>
              <ul className="space-y-1.5">
                {result.actionItems.map((item, index) => (
                  <li key={item}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 accent-[var(--primary)]"
                        checked={checked.has(index)}
                        onChange={(event) => setChecked((prev) => { const next = new Set(prev); if (event.target.checked) next.add(index); else next.delete(index); return next; })}
                      />
                      <span>{item}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void addTasks()} disabled={busy || checked.size === 0 || tasksAdded !== null}>
                {tasksAdded !== null ? `Added ${tasksAdded} task${tasksAdded === 1 ? "" : "s"}` : "Add selected as tasks"}
              </Button>
            </div>
          ) : null}
          {savedNote ? (
            <p role="status" className="text-success">
              Saved. <Link href={`/notes/${savedNote}`} className="underline underline-offset-2">Open the note</Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
