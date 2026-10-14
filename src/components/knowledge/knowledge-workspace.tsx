"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, NotebookPen, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { MemoryPanel } from "@/components/knowledge/memory-panel";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { formatRelativeDate } from "@/lib/format";
import { ACCEPTED_EXTENSIONS } from "@/lib/knowledge/accepted";
import { KIND_LABELS, MAX_PASTED_CHARS, MAX_UPLOAD_BYTES, type DocumentDto, type SearchHit, type SearchMode } from "@/lib/knowledge/types";
import { cn } from "@/lib/utils";

type Tab = "documents" | "memory";

function message(error: unknown, fallback: string): string {
  return error instanceof ClientApiError ? error.message : fallback;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function KnowledgeWorkspace() {
  const [tab, setTab] = useState<Tab>("documents");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge"
        title="Everything you've saved"
        description="Documents and memories the assistant can draw on. Answers that use them show exactly which pieces they came from."
      />
      <div role="tablist" aria-label="Knowledge sections" className="flex gap-6 border-b border-border">
        {(["documents", "memory"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {id === "documents" ? "Documents" : "Memory"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "documents" ? <DocumentsPanel /> : <MemoryPanel />}
      </div>
    </div>
  );
}

interface UploadStatus {
  name: string;
  state: "uploading" | "done" | "failed";
  error?: string;
}

function DocumentsPanel() {
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [deleting, setDeleting] = useState<DocumentDto | null>(null);
  const [syncing, setSyncing] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<{ documents: DocumentDto[] }>("/api/knowledge");
      setDocuments(data.documents);
      setError(null);
    } catch (caught) {
      setError(message(caught, "Couldn't load your documents."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  const indexing = documents?.some((doc) => doc.status === "processing") ?? false;
  useEffect(() => {
    if (!indexing) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [indexing, load]);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setNotice(null);
    setUploads(files.map((file) => ({ name: file.name, state: "uploading" })));
    for (const [index, file] of files.entries()) {
      const update = (patch: Partial<UploadStatus>) => setUploads((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
      if (file.size > MAX_UPLOAD_BYTES) {
        update({ state: "failed", error: `Too large (limit ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).` });
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/knowledge", { method: "POST", body: form });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(data?.error?.message ?? `The upload failed (HTTP ${response.status}).`);
        }
        update({ state: "done" });
        await load();
      } catch (caught) {
        update({ state: "failed", error: caught instanceof Error ? caught.message : "The upload failed." });
      }
    }
  }

  async function syncNotes() {
    setSyncing(true);
    setError(null);
    try {
      const result = await apiRequest<{ added: number; updated: number; removed: number }>("/api/knowledge/sync-notes", { method: "POST", json: {} });
      setNotice(
        result.added + result.updated + result.removed === 0
          ? "Your notes are already up to date here."
          : `Notes synced: ${result.added} added, ${result.updated} updated, ${result.removed} removed.`,
      );
      await load();
    } catch (caught) {
      setError(message(caught, "Couldn't sync your notes."));
    } finally {
      setSyncing(false);
    }
  }

  async function reindex(id?: string) {
    setError(null);
    try {
      await apiRequest("/api/knowledge/reindex", { json: id ? { documentId: id } : {} });
      await load();
    } catch (caught) {
      setError(message(caught, "Couldn't start re-indexing."));
    }
  }

  async function remove(doc: DocumentDto) {
    try {
      await apiRequest(`/api/knowledge/${doc.id}`, { method: "DELETE" });
      setDeleting(null);
      await load();
    } catch (caught) {
      setError(message(caught, "Couldn't delete that document."));
      setDeleting(null);
    }
  }

  return (
    <div
      className={cn("space-y-6 rounded-lg transition-colors", dragging && "bg-accent/50 outline-2 -outline-offset-2 outline-dashed outline-primary")}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
          aria-label="Choose files to add"
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Button variant="primary" onClick={() => fileInput.current?.click()}>
          <Upload className="size-4" aria-hidden /> Add files
        </Button>
        <Button variant="outline" onClick={() => setPasteOpen(true)}>
          <Plus className="size-4" aria-hidden /> Paste text
        </Button>
        <Button variant="outline" onClick={() => void syncNotes()} disabled={syncing}>
          {syncing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <NotebookPen className="size-4" aria-hidden />} Index my notes
        </Button>
        {documents && documents.length > 0 ? (
          <Button variant="ghost" onClick={() => void reindex()} title="Rebuild the search index, for example after changing the embedding model">
            <RefreshCw className="size-4" aria-hidden /> Re-index all
          </Button>
        ) : null}
        <p className="ml-auto hidden text-xs text-muted-foreground lg:block">PDF, Word, Excel, CSV, Markdown, text, code, and images. Drop files anywhere here.</p>
      </div>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}

      {uploads.length > 0 ? (
        <ul aria-label="Uploads" className="divide-y divide-border border-y border-border text-sm">
          {uploads.map((entry, index) => (
            <li key={`${entry.name}-${index}`} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.state === "uploading" ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Uploading" /> : null}
              {entry.state === "done" ? <span className="text-xs text-success">Added</span> : null}
              {entry.state === "failed" ? <span role="alert" className="text-xs text-danger">{entry.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <SearchBox />

      <section aria-labelledby="docs-heading" className="space-y-3">
        <h2 id="docs-heading" className="eyebrow">
          Your documents{documents ? ` · ${documents.length}` : ""}
        </h2>
        {!documents ? (
          <SkeletonRows count={3} />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing here yet"
            description="Add a file, paste some text, or index your notes. Once something is added, chat can answer from it and show you where each answer came from."
          />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/knowledge/${doc.id}`} className="truncate font-medium hover:text-primary">
                      {doc.name}
                    </Link>
                    <Badge>{KIND_LABELS[doc.kind]}</Badge>
                  </div>
                  <p className="num mt-0.5 text-xs text-muted-foreground">
                    {doc.sourceType === "note" ? "From your notes" : formatSize(doc.sizeBytes)} · {doc.chunkCount} {doc.chunkCount === 1 ? "piece" : "pieces"} · added {formatRelativeDate(doc.createdAt)}
                  </p>
                  {doc.error ? <p className="mt-1 text-xs text-warning">{doc.error}</p> : null}
                </div>
                <div className="flex items-center gap-1">
                  {doc.status === "processing" ? (
                    <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> Indexing {doc.embeddedCount}/{doc.chunkCount}
                    </span>
                  ) : doc.embeddedCount < doc.chunkCount ? (
                    <Button size="sm" variant="ghost" onClick={() => void reindex(doc.id)} aria-label={`Re-index ${doc.name}`}>
                      <RefreshCw className="size-3.5" aria-hidden /> Re-index
                    </Button>
                  ) : (
                    <span className="text-xs text-success">Ready</span>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => setDeleting(doc)} aria-label={`Delete ${doc.name}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pasteOpen ? (
        <PasteDialog
          onClose={() => setPasteOpen(false)}
          onAdded={async () => {
            setPasteOpen(false);
            await load();
          }}
        />
      ) : null}
      {deleting ? (
        <Dialog
          title="Delete this document?"
          description={`"${deleting.name}" and its ${deleting.chunkCount} searchable pieces will be removed. The original file isn't kept anywhere else by Omni.`}
          onClose={() => setDeleting(null)}
          size="md"
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void remove(deleting)} className="bg-danger hover:bg-danger/90">
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">Past chat answers keep their source notes, but the links to this document will stop working.</p>
        </Dialog>
      ) : null}
    </div>
  );
}

function PasteDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/api/knowledge", { json: { name: name.trim() || "Pasted text", text } });
      await onAdded();
    } catch (caught) {
      setError(message(caught, "Couldn't add that text."));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Paste text"
      description="Add something you've copied from elsewhere, like an article, an email, or meeting notes."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="paste-form" disabled={saving || !text.trim()}>
            {saving ? "Adding…" : "Add to knowledge"}
          </Button>
        </>
      }
    >
      <form id="paste-form" onSubmit={submit} className="space-y-3">
        <Field label="Title" htmlFor="paste-name">
          <Input id="paste-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Pasted text" maxLength={200} />
        </Field>
        <Field label="Text" htmlFor="paste-text" hint={`${text.length.toLocaleString()} / ${MAX_PASTED_CHARS.toLocaleString()} characters`}>
          <Textarea id="paste-text" data-autofocus value={text} onChange={(event) => setText(event.target.value)} rows={10} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
      </form>
    </Dialog>
  );
}

function highlight(text: string, query: string) {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, index) => (index % 2 === 1 ? <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-foreground">{part}</mark> : part));
}

function SearchBox() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ query: string; mode: SearchMode; hits: SearchHit[]; warning: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<{ mode: SearchMode; hits: SearchHit[]; warning: string | null }>("/api/knowledge/search", { json: { query: trimmed, k: 8 } });
      setResult({ query: trimmed, ...data });
    } catch (caught) {
      setError(message(caught, "The search failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="search-heading" className="space-y-3">
      <h2 id="search-heading" className="eyebrow">
        Search what you&apos;ve saved
      </h2>
      <form onSubmit={search} className="flex gap-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask a question or search for a phrase" aria-label="Search your knowledge" maxLength={1000} />
        <Button type="submit" variant="outline" disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />} Search
        </Button>
      </form>
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {result ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            {result.hits.length === 0 ? "No matches." : `${result.hits.length} match${result.hits.length === 1 ? "" : "es"}`} ·{" "}
            {result.mode === "semantic" ? "searched by meaning" : "searched by keyword"}
          </p>
          {result.warning ? <p className="text-xs text-warning">{result.warning}</p> : null}
          <ul className="divide-y divide-border border-y border-border">
            {result.hits.map((hit) => (
              <li key={hit.chunkId} className="space-y-1 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <Link href={`/knowledge/${hit.documentId}?chunk=${hit.chunkId}`} className="text-sm font-medium text-foreground hover:text-primary">
                    {hit.documentName}
                  </Link>
                  {hit.page ? <span>page {hit.page}</span> : null}
                  {hit.heading ? <span>· {hit.heading}</span> : null}
                  <span className="num ml-auto">{Math.round(hit.score * 100)}% match</span>
                </div>
                <p className="line-clamp-4 text-sm leading-6">{highlight(hit.content, result.query)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
