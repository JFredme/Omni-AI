"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Pin, PinOff, Wand2, Trash2 } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { ProposalDialog, type SummaryChoice } from "@/components/ai/proposal-dialog";
import { Markdown } from "@/components/chat/markdown";
import { describeError } from "@/components/chat/use-model-catalog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest } from "@/lib/client/api";
import { useAutosave, type SaveStatus } from "@/lib/client/use-autosave";
import { countWords, insertSummary } from "@/lib/notes/logic";
import { MAX_NOTE_CONTENT, MAX_NOTE_TITLE } from "@/lib/notes/schemas";
import { normalizeTags } from "@/lib/tags";
import type { FolderDto, NoteDto } from "@/lib/notes/types";
import { cn } from "@/lib/utils";

type Mode = "write" | "preview" | "split";

interface Draft {
  title: string;
  content: string;
  tags: string[];
}

const sameDraft = (a: Draft, b: Draft) =>
  a.title === b.title && a.content === b.content && a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "All changes saved",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  saved: "All changes saved",
  error: "Couldn't save",
};

/** Edits one note. Changes to the title, text, and tags save automatically; folder and pin save immediately. */
export function NoteEditor({
  note,
  folders,
  onSaved,
  onDeleted,
  onBack,
}: {
  note: NoteDto;
  folders: FolderDto[];
  onSaved: (note: NoteDto) => void;
  onDeleted: (id: string) => void;
  onBack: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState(note.tags);
  const [folderId, setFolderId] = useState(note.folderId ?? "");
  const [pinned, setPinned] = useState(note.pinned);
  const [mode, setMode] = useState<Mode>("write");
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  const draft = useMemo<Draft>(() => ({ title, content, tags }), [title, content, tags]);
  const initial = useMemo<Draft>(() => ({ title: note.title, content: note.content, tags: note.tags }), [note]);

  const { status, error, flush } = useAutosave<Draft>({
    value: draft,
    initial,
    isEqual: sameDraft,
    save: async (value) => {
      const result = await apiRequest<{ note: NoteDto }>(`/api/notes/${note.id}`, { method: "PATCH", json: value });
      onSaved(result.note);
    },
  });

  async function patchNow(patch: { folderId?: string | null; pinned?: boolean }) {
    try {
      const result = await apiRequest<{ note: NoteDto }>(`/api/notes/${note.id}`, { method: "PATCH", json: patch });
      onSaved(result.note);
    } catch (caught) {
      setBanner(describeError(caught));
      setFolderId(note.folderId ?? "");
      setPinned(note.pinned);
    }
  }

  async function remove() {
    try {
      await apiRequest(`/api/notes/${note.id}`, { method: "DELETE" });
      onDeleted(note.id);
    } catch (caught) {
      setBanner(describeError(caught));
      setConfirmingDelete(false);
    }
  }

  async function startSummary() {
    setBanner(null);
    // The assistant reads the saved note, so save what's on screen first.
    if (!(await flush())) {
      setBanner("Couldn't save your latest changes, so the summary wasn't started. Try again.");
      return;
    }
    setSummarizing(true);
  }

  async function insertChosenSummary(choice: SummaryChoice) {
    const nextContent = insertSummary(content, choice);
    const nextTags = normalizeTags([...tags, ...choice.tags]);
    const result = await apiRequest<{ note: NoteDto }>(`/api/notes/${note.id}`, {
      method: "PATCH",
      json: { content: nextContent, tags: nextTags },
    });
    setContent(result.note.content);
    setTags(result.note.tags);
    onSaved(result.note);
  }

  const words = countWords(content);
  const showEditor = mode !== "preview";
  const showPreview = mode !== "write";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 lg:hidden">
          <ArrowLeft className="size-4" aria-hidden />
          Notes
        </Button>
        <Input
          value={title}
          maxLength={MAX_NOTE_TITLE}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled"
          aria-label="Note title"
          className="h-10 min-w-48 flex-1 border-transparent bg-transparent text-lg font-semibold hover:border-border"
        />
        <div role="group" aria-label="Editor mode" className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(
            [
              ["write", "Write"],
              ["preview", "Preview"],
              ["split", "Split"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                value === "split" && "hidden lg:inline-block",
                mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {banner ? <ErrorBanner message={banner} onDismiss={() => setBanner(null)} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Folder"
          value={folderId}
          onChange={(event) => {
            setFolderId(event.target.value);
            void patchNow({ folderId: event.target.value || null });
          }}
          className="w-auto max-w-48"
        >
          <option value="">No folder</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </Select>
        <Button
          variant="outline"
          aria-pressed={pinned}
          onClick={() => {
            setPinned(!pinned);
            void patchNow({ pinned: !pinned });
          }}
        >
          {pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
          {pinned ? "Unpin" : "Pin"}
        </Button>
        <Button variant="outline" onClick={startSummary} disabled={!content.trim()}>
          <Wand2 className="size-4" aria-hidden />
          Summarize
        </Button>
        <ExportMenu
          options={[
            { label: "PDF", href: `/api/notes/${note.id}/export?format=pdf` },
            { label: "Word (.docx)", href: `/api/notes/${note.id}/export?format=docx` },
            { label: "Markdown", href: `/api/notes/${note.id}/export?format=md` },
            { label: "Plain text", href: `/api/notes/${note.id}/export?format=txt` },
          ]}
        />
        {confirmingDelete ? (
          <span className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Delete this note?</span>
            <Button size="sm" className="bg-danger text-white hover:opacity-90" onClick={remove}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button variant="ghost" className="ml-auto text-danger hover:text-danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
        )}
      </div>

      <TagInput tags={tags} onChange={setTags} label="Note tags" />

      <div className={cn("grid gap-3", mode === "split" && "lg:grid-cols-2")}>
        {showEditor ? (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={MAX_NOTE_CONTENT}
            aria-label="Note content"
            placeholder="Start writing… Markdown is supported."
            spellCheck
            className="field-sizing-content min-h-[50dvh] w-full resize-none rounded-xl border border-border bg-card p-4 font-mono text-sm leading-7 outline-none focus:border-ring"
          />
        ) : null}
        {showPreview ? (
          <div aria-label="Preview" className="min-h-[50dvh] rounded-xl border border-border bg-card p-4">
            {content.trim() ? <Markdown>{content}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {words} word{words === 1 ? "" : "s"}
        </span>
        <span role="status" aria-live="polite" className={cn(status === "error" && "text-danger")}>
          {STATUS_TEXT[status]}
          {status === "error" ? (
            <>
              {error ? `: ${error}` : ""}{" "}
              <button type="button" onClick={() => void flush()} className="font-medium underline underline-offset-2">
                Retry
              </button>
            </>
          ) : null}
        </span>
      </div>

      {summarizing ? (
        <ProposalDialog
          request={{ kind: "note_summary", noteId: note.id }}
          onClose={() => setSummarizing(false)}
          onApplied={() => undefined}
          onInsertSummary={insertChosenSummary}
        />
      ) : null}
    </div>
  );
}
