"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2, Presentation, Table2, Wand2 } from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { downloadExport } from "@/components/documents/download";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { blocksToMarkdown, markdownToBlocks } from "@/lib/documents/markdown";
import { DECK_FORMATS, DOCUMENT_FORMATS, FORMAT_LABELS, SHEET_FORMATS, type DeckModel, type ExportRequest, type SheetModel } from "@/lib/documents/model";
import type { Generated, GenerateKind } from "@/lib/documents/generate";
import { cn } from "@/lib/utils";

const KINDS: { id: GenerateKind; label: string; icon: typeof FileText; placeholder: string }[] = [
  { id: "document", label: "Document", icon: FileText, placeholder: "For example: A one-page project proposal for moving our team to a four-day week, with risks and a rollout plan." },
  { id: "deck", label: "Slides", icon: Presentation, placeholder: "For example: A 10-slide pitch for a neighborhood tool library." },
  { id: "sheet", label: "Spreadsheet", icon: Table2, placeholder: "For example: A monthly household budget with categories, planned amounts, and room for actuals." },
];

interface NoteOption {
  id: string;
  title: string;
}

function message(error: unknown, fallback: string) {
  return error instanceof ClientApiError ? error.message : error instanceof Error ? error.message : fallback;
}

export function DocumentsWorkspace() {
  const [kind, setKind] = useState<GenerateKind>("document");
  const [prompt, setPrompt] = useState("");
  const [noteId, setNoteId] = useState("");
  const [notes, setNotes] = useState<NoteOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // What is being worked on. A document is edited as Markdown; slides and spreadsheets are reviewed as drafted.
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [deck, setDeck] = useState<DeckModel | null>(null);
  const [sheet, setSheet] = useState<SheetModel | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [modelId, setModelId] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ notes: { id: string; title: string }[] }>("/api/notes")
      .then((data) => setNotes(data.notes.map((note) => ({ id: note.id, title: note.title || "Untitled note" }))))
      .catch(() => undefined);
  }, []);

  const info = KINDS.find((entry) => entry.id === kind)!;
  const hasResult = kind === "document" ? markdown.trim().length > 0 || title.trim().length > 0 : kind === "deck" ? deck !== null : sheet !== null;
  const blocks = useMemo(() => markdownToBlocks(markdown), [markdown]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWarnings([]);
    setSaved(null);
    try {
      const data = await apiRequest<{ result: Generated; modelId: string }>("/api/documents/generate", { json: { kind, prompt, ...(noteId ? { noteId } : {}) } });
      setModelId(data.modelId);
      if (data.result.kind === "document") {
        setTitle(data.result.document.title);
        setMarkdown(blocksToMarkdown({ title: "", blocks: data.result.document.blocks }).replace(/^# \n\n?/, ""));
      } else if (data.result.kind === "deck") setDeck(data.result.deck);
      else {
        setSheet(data.result.sheet);
        setSheetIndex(0);
      }
    } catch (caught) {
      setError(message(caught, "Couldn't draft that."));
    } finally {
      setBusy(false);
    }
  }

  function requestFor(format: string): ExportRequest | null {
    if (kind === "document") return { kind: "document", format: format as (typeof DOCUMENT_FORMATS)[number], document: { title: title.trim() || "Untitled", blocks } };
    if (kind === "deck" && deck) return { kind: "deck", format: format as (typeof DECK_FORMATS)[number], deck };
    if (kind === "sheet" && sheet) return { kind: "sheet", format: format as (typeof SHEET_FORMATS)[number], sheet };
    return null;
  }

  async function download(format: string) {
    const request = requestFor(format);
    if (!request) return;
    setDownloading(format);
    setError(null);
    try {
      setWarnings(await downloadExport(request));
    } catch (caught) {
      setError(message(caught, "The download failed."));
    } finally {
      setDownloading(null);
    }
  }

  async function saveAsNote() {
    setError(null);
    try {
      await apiRequest("/api/notes", { json: { title: title.trim() || "Untitled", content: markdown } });
      setSaved("Saved as a note.");
    } catch (caught) {
      setError(message(caught, "Couldn't save the note."));
    }
  }

  const formats = kind === "document" ? DOCUMENT_FORMATS : kind === "deck" ? DECK_FORMATS : SHEET_FORMATS;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Knowledge" title="Documents" description="Describe what you need, review the draft, then download it as a PDF, Word file, slide deck, or spreadsheet. You can also write a document yourself." />

      <div role="tablist" aria-label="What to create" className="flex gap-6 border-b border-border">
        {KINDS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={kind === entry.id}
            onClick={() => {
              setKind(entry.id);
              setError(null);
              setWarnings([]);
              setSaved(null);
            }}
            className={cn("-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium transition-colors", kind === entry.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <entry.icon className="size-4" aria-hidden /> {entry.label}
          </button>
        ))}
      </div>

      <form onSubmit={generate} className="max-w-3xl space-y-3">
        <Field label="What should it be?" htmlFor="doc-prompt">
          <Textarea id="doc-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={4000} placeholder={info.placeholder} disabled={busy} />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Base it on a note (optional)" htmlFor="doc-note">
            <Select id="doc-note" value={noteId} onChange={(e) => setNoteId(e.target.value)} disabled={busy} className="w-64">
              <option value="">None</option>
              {notes.map((note) => (
                <option key={note.id} value={note.id}>
                  {note.title}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" disabled={busy || prompt.trim().length < 5}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />} {hasResult ? "Draft again" : "Draft it"}
          </Button>
          {kind === "document" && !hasResult ? (
            <Button type="button" variant="outline" onClick={() => { setTitle("Untitled"); setMarkdown("# Heading\n\nStart writing here.\n"); }}>
              Write it myself
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">The draft is written by your default model from your request{noteId ? " and the note you chose" : ""}. Nothing is saved or sent anywhere else, and the model can be wrong, so read it before you use it.</p>
      </form>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {hasResult ? (
        <section aria-label="Draft" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="eyebrow mr-auto">Your draft{modelId ? ` · written by ${modelId}` : ""}</h2>
            {formats.map((format) => (
              <Button key={format} size="sm" variant="outline" disabled={downloading !== null} onClick={() => void download(format)}>
                {downloading === format ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />} {FORMAT_LABELS[format]}
              </Button>
            ))}
            {kind === "document" ? (
              <Button size="sm" variant="outline" onClick={() => void saveAsNote()}>
                Save as note
              </Button>
            ) : null}
          </div>
          {saved ? <p role="status" className="text-sm text-success">{saved}</p> : null}
          {warnings.map((warning) => (
            <p key={warning} role="status" className="text-xs text-warning">
              {warning}
            </p>
          ))}

          {kind === "document" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <Field label="Title" htmlFor="doc-title">
                  <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                </Field>
                <Field label="Text (Markdown)" htmlFor="doc-markdown" hint="Edit freely. Headings, lists, tables, code blocks, bold, italic, and links are kept in the file.">
                  <Textarea id="doc-markdown" value={markdown} onChange={(e) => setMarkdown(e.target.value)} rows={22} className="font-mono text-[13px]" />
                </Field>
              </div>
              <div aria-label="Preview" className="rounded-lg border border-border p-5">
                <h3 className="font-display mb-3 text-2xl font-medium leading-tight">{title || "Untitled"}</h3>
                <Markdown>{markdown}</Markdown>
              </div>
            </div>
          ) : null}

          {kind === "deck" && deck ? (
            <div aria-label="Slides">
              <h3 className="font-display mb-3 text-2xl font-medium">{deck.title}</h3>
              <ol className="grid gap-4 sm:grid-cols-2">
                {deck.slides.map((slide, index) => (
                  <li key={index} className="space-y-2 rounded-lg border border-border p-4">
                    <p className="eyebrow">Slide {index + 1}</p>
                    <p className="font-display text-lg font-medium leading-snug">{slide.title}</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {slide.bullets.map((bullet, i) => (
                        <li key={i}>{bullet}</li>
                      ))}
                    </ul>
                    {slide.notes ? <p className="text-xs text-muted-foreground">Speaker notes: {slide.notes}</p> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {kind === "sheet" && sheet ? (
            <div aria-label="Spreadsheet" className="space-y-3">
              <h3 className="font-display text-2xl font-medium">{sheet.title}</h3>
              {sheet.sheets.length > 1 ? (
                <div role="tablist" aria-label="Sheets" className="flex flex-wrap gap-2">
                  {sheet.sheets.map((entry, index) => (
                    <button key={index} role="tab" type="button" aria-selected={sheetIndex === index} onClick={() => setSheetIndex(index)} className={cn("rounded-md border px-3 py-1 text-sm", sheetIndex === index ? "border-primary bg-primary/10" : "border-border")}>
                      {entry.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {sheet.sheets[sheetIndex].header.map((head, i) => (
                        <th key={i} className="border-b border-border px-3 py-2 font-semibold">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.sheets[sheetIndex].rows.slice(0, 200).map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} className={cn("border-b border-border/60 px-3 py-1.5", typeof cell === "number" && "num text-right")}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sheet.sheets[sheetIndex].rows.length > 200 ? <p className="text-xs text-muted-foreground">Showing the first 200 rows. The download has all {sheet.sheets[sheetIndex].rows.length}.</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
