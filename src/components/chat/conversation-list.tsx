"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatRelativeDate } from "@/lib/format";
import type { ConversationSummary } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

export function ConversationList({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
  loading,
}: {
  conversations: ConversationSummary[] | null;
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visible = (conversations ?? []).filter((conversation) =>
    conversation.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNew}
          className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden />
          New chat
        </button>
      </div>

      {conversations && conversations.length > 5 ? (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter conversations"
          aria-label="Filter conversations"
          className="h-8 rounded-lg border border-border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
        />
      ) : null}

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto">
        {loading && conversations === null ? (
          <div className="space-y-2" aria-label="Loading conversations">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {conversations && conversations.length > 0 ? "No conversations match." : "No conversations yet."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((conversation) => {
              const active = conversation.id === activeId;
              const confirming = confirmingId === conversation.id;
              return (
                <li
                  key={conversation.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingId(null);
                      onSelect(conversation.id);
                    }}
                    aria-current={active ? "true" : undefined}
                    className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left"
                  >
                    <span className="block truncate text-sm font-medium">{conversation.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {conversation.messageCount} message{conversation.messageCount === 1 ? "" : "s"} ·{" "}
                      {formatRelativeDate(conversation.updatedAt)}
                    </span>
                  </button>
                  {confirming ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingId(null);
                          onDelete(conversation.id);
                        }}
                        className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(conversation.id)}
                      aria-label={`Delete ${conversation.title}`}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
