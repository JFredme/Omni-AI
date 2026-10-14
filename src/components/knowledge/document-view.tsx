"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner, SkeletonRows } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { KIND_LABELS, type ChunkDto, type DocumentDto } from "@/lib/knowledge/types";
import { cn } from "@/lib/utils";

export function DocumentView({ id }: { id: string }) {
  const highlighted = useSearchParams().get("chunk");
  const [data, setData] = useState<{ document: DocumentDto; chunks: ChunkDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ document: DocumentDto; chunks: ChunkDto[] }>(`/api/knowledge/${id}`)
      .then((result) => !cancelled && setData(result))
      .catch((caught) => !cancelled && setError(caught instanceof ClientApiError ? caught.message : "Couldn't load that document."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (data && highlighted) target.current?.scrollIntoView?.({ block: "center" });
  }, [data, highlighted]);

  return (
    <div className="space-y-6">
      <Link href="/knowledge" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Knowledge
      </Link>
      {error ? <ErrorBanner message={error} /> : null}
      {!data && !error ? <SkeletonRows count={4} /> : null}
      {data ? (
        <>
          <header className="space-y-2 border-b border-border pb-5">
            <p className="eyebrow">{KIND_LABELS[data.document.kind]}</p>
            <h1 className="font-display text-3xl font-medium leading-tight">{data.document.name}</h1>
            <p className="num text-sm text-muted-foreground">
              {data.document.chunkCount} pieces · {data.document.embeddedCount} indexed for meaning-based search
            </p>
            {data.document.error ? <p className="text-sm text-warning">{data.document.error}</p> : null}
          </header>
          <ol className="space-y-4">
            {data.chunks.map((chunk) => (
              <li
                key={chunk.id}
                ref={chunk.id === highlighted ? target : undefined}
                className={cn("rounded-lg border p-4", chunk.id === highlighted ? "border-primary bg-primary/5" : "border-border")}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="num font-mono">#{chunk.index + 1}</span>
                  {chunk.page ? <Badge>Page {chunk.page}</Badge> : null}
                  {chunk.heading ? <span>{chunk.heading}</span> : null}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{chunk.content}</p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}
