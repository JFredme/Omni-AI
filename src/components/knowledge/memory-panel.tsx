"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarked, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { formatRelativeDate } from "@/lib/format";
import { MAX_MEMORY_CHARS, type MemoryDto } from "@/lib/knowledge/types";

type Hit = MemoryDto & { score?: number };

function message(error: unknown, fallback: string): string {
  return error instanceof ClientApiError ? error.message : fallback;
}

export function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryDto[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MemoryDto | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([
        apiRequest<{ memories: MemoryDto[] }>("/api/memory"),
        apiRequest<{ memoryEnabled: boolean }>("/api/knowledge/settings"),
      ]);
      setMemories(list.memories);
      setEnabled(settings.memoryEnabled);
      setError(null);
    } catch (caught) {
      setError(message(caught, "Couldn't load your memories."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const submitted = draft;
    if (!submitted.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await apiRequest("/api/memory", { json: { content: submitted } });
      // Keep anything typed while this was saving.
      setDraft((current) => (current === submitted ? "" : current));
      await load();
    } catch (caught) {
      setError(message(caught, "Couldn't save that memory."));
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await apiRequest(`/api/memory/${editing.id}`, { method: "PATCH", json: { content: editText } });
      setEditing(null);
      setFound(null);
      await load();
    } catch (caught) {
      setError(message(caught, "Couldn't save that change."));
    }
  }

  async function remove(id: string) {
    try {
      await apiRequest(`/api/memory/${id}`, { method: "DELETE" });
      setFound(null);
      await load();
    } catch (caught) {
      setError(message(caught, "Couldn't delete that memory."));
    }
  }

  async function toggle(next: boolean) {
    setEnabled(next);
    try {
      await apiRequest("/api/knowledge/settings", { method: "PATCH", json: { memoryEnabled: next } });
    } catch (caught) {
      setEnabled(!next);
      setError(message(caught, "Couldn't change that setting."));
    }
  }

  async function clearAll() {
    try {
      await apiRequest("/api/memory?confirm=all", { method: "DELETE" });
      setConfirmClear(false);
      setFound(null);
      await load();
    } catch (caught) {
      setConfirmClear(false);
      setError(message(caught, "Couldn't clear your memories."));
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setFound(null);
      return;
    }
    try {
      const data = await apiRequest<{ hits: Hit[] }>("/api/memory/search", { json: { query: query.trim(), k: 10 } });
      setFound(data.hits);
    } catch (caught) {
      setError(message(caught, "The search failed."));
    }
  }

  const shown: Hit[] = found ?? memories ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="max-w-xl space-y-1">
          <p className="font-medium">Use memories in chat</p>
          <p className="text-sm text-muted-foreground">
            When on, the memories most relevant to your message are sent to the model along with it. When off, nothing here leaves your database.
          </p>
        </div>
        {enabled !== null ? (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Use memories in chat"
            onClick={() => void toggle(!enabled)}
            className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${enabled ? "border-primary bg-primary" : "border-input bg-muted"}`}
          >
            <span className={`absolute top-0.5 size-4.5 rounded-full bg-background transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <form onSubmit={add} className="space-y-2">
        <label htmlFor="new-memory" className="eyebrow block">
          Add a memory
        </label>
        <div className="flex gap-2">
          <Textarea
            id="new-memory"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={MAX_MEMORY_CHARS}
            placeholder="For example: I prefer metric units. My manager is Dana."
          />
          <Button type="submit" variant="primary" disabled={adding || !draft.trim()} className="self-start">
            <Plus className="size-4" aria-hidden /> Save
          </Button>
        </div>
      </form>

      <section aria-labelledby="memories-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="memories-heading" className="eyebrow mr-auto">
            {found ? `${found.length} found` : `Saved memories${memories ? ` · ${memories.length}` : ""}`}
          </h2>
          <form onSubmit={search} className="flex gap-2">
            <Input value={query} onChange={(event) => { setQuery(event.target.value); if (!event.target.value) setFound(null); }} placeholder="Search memories" aria-label="Search memories" className="w-48" />
          </form>
          {memories && memories.length > 0 ? (
            <>
              <a href="/api/memory/export" download className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                <Download className="size-4" aria-hidden /> Export
              </a>
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                Delete all
              </Button>
            </>
          ) : null}
        </div>

        {!memories ? (
          <SkeletonRows count={3} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title={found ? "No memories match that" : "No memories yet"}
            description={found ? undefined : "Save facts and preferences you want the assistant to keep in mind. You can also hover over any message you've sent in chat and choose Remember this."}
          />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {shown.map((memory) => (
              <li key={memory.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{memory.content}</p>
                  <p className="num mt-0.5 text-xs text-muted-foreground">
                    {memory.source === "user" ? "Added by you" : memory.source === "agent" ? "Saved by an agent" : "From chat"} · {formatRelativeDate(memory.createdAt)}
                    {memory.score !== undefined ? ` · ${Math.round(memory.score * 100)}% match` : ""}
                  </p>
                </div>
                <Button size="icon" variant="ghost" aria-label="Edit memory" onClick={() => { setEditing(memory); setEditText(memory.content); }}>
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Delete memory" onClick={() => void remove(memory.id)}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing ? (
        <Dialog
          title="Edit memory"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void saveEdit()} disabled={!editText.trim()}>
                Save changes
              </Button>
            </>
          }
        >
          <Textarea data-autofocus value={editText} onChange={(event) => setEditText(event.target.value)} rows={5} maxLength={MAX_MEMORY_CHARS} aria-label="Memory text" />
        </Dialog>
      ) : null}

      {confirmClear ? (
        <Dialog
          title="Delete every memory?"
          description="This can't be undone. Export first if you want a copy."
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button variant="primary" className="bg-danger hover:bg-danger/90" onClick={() => void clearAll()}>
                Delete all
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">{memories?.length ?? 0} memories will be removed from your database.</p>
        </Dialog>
      ) : null}
    </div>
  );
}
