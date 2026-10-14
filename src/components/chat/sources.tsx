"use client";

import Link from "next/link";
import { useState } from "react";
import { BookMarked, BookOpen } from "lucide-react";
import type { Citation } from "@/lib/knowledge/types";
import { cn } from "@/lib/utils";

/** Numbers the reply cites, like [1] or [2][3]. Only numbers that match a retrieved source count. */
export function citedNumbers(content: string, citations: Citation[]): Set<number> {
  const known = new Set(citations.filter((c) => c.kind === "source").map((c) => c.n));
  const cited = new Set<number>();
  for (const match of content.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(match[1]);
    if (known.has(n)) cited.add(n);
  }
  return cited;
}

export function Sources({ citations, content }: { citations: Citation[]; content: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const sources = citations.filter((c) => c.kind === "source");
  const memories = citations.filter((c) => c.kind === "memory");
  if (sources.length === 0 && memories.length === 0) return null;
  const cited = citedNumbers(content, citations);
  const active = citations.find((c) => c.n === open) ?? null;

  return (
    <div className="max-w-full space-y-2 px-1 md:max-w-[85%]">
      {sources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1">Sources</span>
          {sources.map((source) => (
            <button
              key={source.n}
              type="button"
              onClick={() => setOpen(open === source.n ? null : source.n)}
              aria-expanded={open === source.n}
              title={cited.has(source.n) ? "Cited in the reply" : "Retrieved, but not cited in the reply"}
              className={cn(
                "inline-flex max-w-56 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors",
                cited.has(source.n) ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                open === source.n && "border-primary",
              )}
            >
              <span className="num font-mono text-[11px]">{source.n}</span>
              <span className="truncate">{source.name}</span>
              {source.page ? <span className="num shrink-0 text-muted-foreground">p.{source.page}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{active.name}</span>
            {active.page ? <span>page {active.page}</span> : null}
            {active.heading ? <span>· {active.heading}</span> : null}
            <span className="num">· match {Math.round(active.score * 100)}%</span>
          </p>
          <p className="leading-6">{active.snippet}</p>
          {active.documentId ? (
            <Link href={`/knowledge/${active.documentId}`} className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
              <BookOpen className="size-3" aria-hidden /> Open document
            </Link>
          ) : null}
        </div>
      ) : null}

      {memories.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <BookMarked className="size-3" aria-hidden />
          Used {memories.length === 1 ? "a memory" : `${memories.length} memories`}:
          {memories.map((memory) => (
            <span key={memory.n} className="rounded border border-border px-1.5 py-0.5">
              {memory.snippet.length > 60 ? `${memory.snippet.slice(0, 60)}…` : memory.snippet}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
