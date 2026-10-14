"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Columns2, Download, FileText, MoreHorizontal, ScrollText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const itemClass = "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-accent";

/** The less-used conversation actions, kept in one menu so the header stays readable. */
export function ChatMenu({
  conversationId,
  hasMessages,
  hasInstructions,
  onSummarize,
  onInstructions,
}: {
  conversationId: string | null;
  hasMessages: boolean;
  hasInstructions: boolean;
  onSummarize: () => void;
  onInstructions: () => void;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="More actions"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "cursor-pointer list-none text-muted-foreground [&::-webkit-details-marker]:hidden")}
      >
        <MoreHorizontal className="size-4" aria-hidden />
        <span className="hidden sm:inline">More</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground">
        {conversationId ? (
          <button type="button" className={cn(itemClass, hasInstructions && "text-primary")} onClick={() => { close(); onInstructions(); }}>
            <ScrollText className="size-4" aria-hidden /> Instructions{hasInstructions ? " (set)" : ""}
          </button>
        ) : null}
        {hasMessages ? (
          <button type="button" className={itemClass} onClick={() => { close(); onSummarize(); }}>
            <FileText className="size-4" aria-hidden /> Summarize this chat
          </button>
        ) : null}
        <Link href="/chat/compare" className={itemClass} onClick={close}>
          <Columns2 className="size-4" aria-hidden /> Compare models
        </Link>
        {hasMessages && conversationId ? (
          <div className="mt-1 border-t border-border pt-1">
            <p className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
              <Download className="size-3.5" aria-hidden /> Export the version you&apos;re viewing
            </p>
            {([["md", "Markdown"], ["txt", "Plain text"], ["json", "JSON"]] as const).map(([format, label]) => (
              <a key={format} href={`/api/conversations/${conversationId}/export?format=${format}`} download className={cn(itemClass, "pl-9")} onClick={close}>
                {label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
