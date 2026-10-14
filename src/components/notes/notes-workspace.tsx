"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, FolderPlus, NotebookPen, Pencil, Pin, Plus, Search, Trash2, Wand2 } from "lucide-react";
import { ProposalDialog } from "@/components/ai/proposal-dialog";
import { describeError } from "@/components/chat/use-model-catalog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorBanner, SkeletonRows, Spinner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { formatRelativeDate } from "@/lib/format";
import { displayTitle, makeExcerpt } from "@/lib/notes/logic";
import { MAX_FOLDER_NAME } from "@/lib/notes/schemas";
import type { FolderDto, NoteDto, NoteSummaryDto, NotesMeta } from "@/lib/notes/types";
import { cn } from "@/lib/utils";
import { NoteEditor } from "./note-editor";

const EMPTY_META: NotesMeta = { folders: [], tags: [], total: 0, unfiled: 0 };

function toSummary(note: NoteDto): NoteSummaryDto {
  const { content, ...rest } = note;
  return { ...rest, excerpt: makeExcerpt(content) };
}

export function NotesWorkspace({ initialId }: { initialId: string | null }) {
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [notes, setNotes] = useState<NoteSummaryDto[] | null>(null);
  const [meta, setMeta] = useState<NotesMeta>(EMPTY_META);
  const [active, setActive] = useState<NoteDto | null>(null);
  const [activeError, setActiveError] = useState<{ id: string; message: string; notFound: boolean } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    activeIdRef.current = activeId;
  });

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (folderFilter) params.set("folderId", folderFilter);
    if (tagFilter) params.set("tag", tagFilter);
    apiRequest<{ notes: NoteSummaryDto[] }>(`/api/notes?${params}`, { signal: controller.signal })
      .then((result) => {
        setNotes(result.notes);
        setListError(null);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setListError(describeError(caught));
      });
    return () => controller.abort();
  }, [q, folderFilter, tagFilter, reloadToken]);

  useEffect(() => {
    apiRequest<NotesMeta>("/api/notes/meta")
      .then(setMeta)
      .catch(() => undefined);
  }, [reloadToken]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    apiRequest<{ note: NoteDto }>(`/api/notes/${activeId}`, { signal: controller.signal })
      .then((result) => {
        setActive(result.note);
        setActiveError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setActiveError({ id: activeId, message: describeError(caught), notFound: caught instanceof ClientApiError && caught.status === 404 });
      });
    return () => controller.abort();
  }, [activeId]);

  useEffect(() => {
    function onPopState() {
      const match = window.location.pathname.match(/^\/notes\/([^/]+)$/);
      setActiveId(match ? match[1] : null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function select(id: string | null) {
    setActiveId(id);
    setActiveError(null);
    if (id === null) setActive(null);
    window.history.pushState(null, "", id ? `/notes/${id}` : "/notes");
  }

  async function createNote() {
    setCreating(true);
    setBanner(null);
    // Take the current note off screen right away (it saves in the background), so nothing typed while the
    // new note is being created can land in the old one.
    setActive(null);
    try {
      const { note } = await apiRequest<{ note: NoteDto }>("/api/notes", {
        json: { ...(folderFilter && folderFilter !== "none" ? { folderId: folderFilter } : {}), ...(tagFilter ? { tags: [tagFilter] } : {}) },
      });
      setActive(note);
      select(note.id);
      reload();
    } catch (caught) {
      setBanner(describeError(caught));
    } finally {
      setCreating(false);
    }
  }

  const handleSaved = useCallback((note: NoteDto) => {
    setActive((prev) => (prev && prev.id === note.id && activeIdRef.current === note.id ? note : prev));
    setNotes((prev) => {
      if (!prev) return prev;
      const next = prev.map((item) => (item.id === note.id ? toSummary(note) : item));
      return next.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    });
    // Tag and folder counts may have changed.
    apiRequest<NotesMeta>("/api/notes/meta")
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  const handleDeleted = useCallback(
    (id: string) => {
      setNotes((prev) => prev?.filter((item) => item.id !== id) ?? prev);
      setActive(null);
      select(null);
      reload();
    },
    [reload],
  );

  async function addFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    try {
      await apiRequest("/api/notes/folders", { json: { name } });
      setFolderName("");
      setAddingFolder(false);
      reload();
    } catch (caught) {
      setBanner(describeError(caught));
    }
  }

  async function renameFolder(event: React.FormEvent) {
    event.preventDefault();
    if (!renaming || !renaming.name.trim()) return;
    try {
      await apiRequest(`/api/notes/folders/${renaming.id}`, { method: "PATCH", json: { name: renaming.name.trim() } });
      setRenaming(null);
      reload();
    } catch (caught) {
      setBanner(describeError(caught));
    }
  }

  async function deleteFolder(folder: FolderDto) {
    try {
      await apiRequest(`/api/notes/folders/${folder.id}`, { method: "DELETE" });
      setDeletingFolder(null);
      if (folderFilter === folder.id) setFolderFilter("");
      reload();
    } catch (caught) {
      setBanner(describeError(caught));
    }
  }

  const hasFilters = Boolean(q || folderFilter || tagFilter);
  const showingEditor = activeId !== null;
  const editorReady = active && active.id === activeId;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={NotebookPen}
        title="Notes"
        description="Markdown notes with folders, tags, autosave, and AI summaries."
        actions={
          <>
            <Button variant="outline" onClick={() => setAiOpen(true)}>
              <Wand2 className="size-4" aria-hidden />
              Organize
            </Button>
            <Button variant="primary" onClick={createNote} disabled={creating}>
              <Plus className="size-4" aria-hidden />
              New note
            </Button>
          </>
        }
      />

      {banner ? <ErrorBanner message={banner} onDismiss={() => setBanner(null)} /> : null}

      <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className={cn("min-w-0 space-y-4", showingEditor && "hidden lg:block")} aria-label="Note library">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" aria-label="Search notes" className="pl-8" />
          </div>

          <nav aria-label="Folders" className="space-y-0.5">
            <FolderButton active={folderFilter === ""} onClick={() => setFolderFilter("")} label="All notes" count={meta.total} />
            <FolderButton active={folderFilter === "none"} onClick={() => setFolderFilter("none")} label="Unfiled" count={meta.unfiled} />
            {meta.folders.map((folder) =>
              renaming?.id === folder.id ? (
                <form key={folder.id} onSubmit={renameFolder} className="flex gap-1 py-0.5">
                  <Input
                    data-autofocus
                    autoFocus
                    value={renaming.name}
                    maxLength={MAX_FOLDER_NAME}
                    aria-label={`Rename folder ${folder.name}`}
                    onChange={(event) => setRenaming({ id: folder.id, name: event.target.value })}
                    onKeyDown={(event) => event.key === "Escape" && setRenaming(null)}
                    className="h-8"
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    Save
                  </Button>
                </form>
              ) : (
                <div key={folder.id} className="group flex items-center">
                  <FolderButton active={folderFilter === folder.id} onClick={() => setFolderFilter(folder.id)} label={folder.name} count={folder.noteCount} />
                  {deletingFolder === folder.id ? (
                    <span className="flex shrink-0 items-center gap-1 pl-1">
                      <button type="button" onClick={() => deleteFolder(folder)} className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white">
                        Delete
                      </button>
                      <button type="button" onClick={() => setDeletingFolder(null)} className="rounded-md px-2 py-1 text-xs text-muted-foreground">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button type="button" onClick={() => setRenaming({ id: folder.id, name: folder.name })} aria-label={`Rename folder ${folder.name}`} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground">
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button type="button" onClick={() => setDeletingFolder(folder.id)} aria-label={`Delete folder ${folder.name}`} className="rounded-md p-1.5 text-muted-foreground hover:text-danger">
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  )}
                </div>
              ),
            )}
            {addingFolder ? (
              <form onSubmit={addFolder} className="flex gap-1 pt-1">
                <Input
                  autoFocus
                  value={folderName}
                  maxLength={MAX_FOLDER_NAME}
                  placeholder="Folder name"
                  aria-label="New folder name"
                  onChange={(event) => setFolderName(event.target.value)}
                  onKeyDown={(event) => event.key === "Escape" && setAddingFolder(false)}
                  className="h-8"
                />
                <Button type="submit" size="sm" variant="secondary" disabled={!folderName.trim()}>
                  Add
                </Button>
              </form>
            ) : (
              <button type="button" onClick={() => setAddingFolder(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground">
                <FolderPlus className="size-4" aria-hidden />
                New folder
              </button>
            )}
          </nav>

          {meta.tags.length > 0 ? (
            <div className="space-y-1.5">
              <p className="px-1 text-xs font-medium text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {meta.tags.map((item) => (
                  <button
                    key={item.tag}
                    type="button"
                    aria-pressed={tagFilter === item.tag}
                    onClick={() => setTagFilter(tagFilter === item.tag ? "" : item.tag)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                      tagFilter === item.tag ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    #{item.tag} <span className="opacity-70">{item.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {listError ? <ErrorBanner message={listError} onRetry={reload} /> : null}

          {notes === null ? (
            listError ? null : <SkeletonRows count={4} />
          ) : notes.length === 0 ? (
            hasFilters ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">No notes match.</p>
            ) : (
              <EmptyState
                icon={FileText}
                title="No notes yet"
                description="Capture ideas in Markdown. They save automatically."
                action={
                  <Button variant="primary" onClick={createNote} disabled={creating}>
                    <Plus className="size-4" aria-hidden />
                    New note
                  </Button>
                }
              />
            )
          ) : (
            <ul className="space-y-1.5" aria-label="Notes">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => select(note.id)}
                    aria-current={note.id === activeId ? "true" : undefined}
                    className={cn(
                      "w-full space-y-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      note.id === activeId ? "border-ring bg-accent" : "border-border bg-card/70 hover:bg-accent/40",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {note.pinned ? <Pin className="size-3 shrink-0 text-primary" aria-label="Pinned" /> : null}
                      <span className="truncate text-sm font-medium">{displayTitle(note)}</span>
                    </span>
                    {note.excerpt ? <span className="line-clamp-2 block text-xs text-muted-foreground">{note.excerpt}</span> : null}
                    <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span>{formatRelativeDate(note.updatedAt)}</span>
                      {note.tags.slice(0, 3).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className={cn("min-w-0", !showingEditor && "hidden lg:block")} aria-label="Note editor">
          {!showingEditor ? (
            <EmptyState icon={NotebookPen} title="Select a note" description="Pick a note from the list, or create a new one." />
          ) : activeError && activeError.id === activeId ? (
            <div className="space-y-3">
              {activeError.notFound ? (
                <EmptyState icon={FileText} title="Note not found" description="It may have been deleted." />
              ) : (
                <ErrorBanner message={activeError.message} onRetry={() => select(activeId)} />
              )}
              <Button variant="outline" onClick={() => select(null)}>
                Back to notes
              </Button>
            </div>
          ) : editorReady ? (
            <NoteEditor key={active.id} note={active} folders={meta.folders} onSaved={handleSaved} onDeleted={handleDeleted} onBack={() => select(null)} />
          ) : (
            <Spinner label="Loading note…" />
          )}
        </section>
      </div>

      {aiOpen ? (
        <ProposalDialog
          request={{ kind: "organize_notes" }}
          onClose={() => setAiOpen(false)}
          onApplied={() => {
            reload();
            if (activeId) {
              apiRequest<{ note: NoteDto }>(`/api/notes/${activeId}`)
                .then((result) => setActive(result.note))
                .catch(() => undefined);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function FolderButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}
