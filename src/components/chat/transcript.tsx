"use client";

import { useState } from "react";
import { AlertTriangle, BookMarked, Check, ChevronLeft, ChevronRight, Copy, FileText, Pencil, RotateCcw, Square } from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { Sources } from "@/components/chat/sources";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import type { Citation } from "@/lib/knowledge/types";
import { formatTokens, formatUsd } from "@/lib/format";
import type { BranchInfo, MessageDto } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

export interface LiveReply {
  text: string;
  modelId: string | null;
  citations: Citation[];
}

export function usageSummary(message: MessageDto): string {
  const usage = message.usage;
  if (!usage || usage.totalTokens === null) return "Usage unavailable";
  const cost =
    usage.costUsd === null
      ? "cost unknown"
      : `${formatUsd(usage.costUsd)}${usage.costSource === "estimated" ? " est." : ""}`;
  return `${formatTokens(usage.promptTokens)} in · ${formatTokens(usage.completionTokens)} out · ${cost}`;
}

export function Transcript({
  messages,
  live,
  streaming,
  canRegenerate,
  onRegenerate,
  onStop,
  onEdit,
  onSwitchBranch,
}: {
  messages: MessageDto[];
  live: LiveReply | null;
  streaming: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onStop: () => void;
  onEdit: (messageId: string, content: string) => void;
  onSwitchBranch: (messageId: string) => void;
}) {
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;

  return (
    <div className="space-y-8">
      {messages.map((message) => {
        if (message.role === "assistant" && message.status === "streaming" && live) return null;
        return (
          <MessageBubble
            key={message.id}
            message={message}
            showRegenerate={canRegenerate && !streaming && message.id === lastAssistantId}
            onRegenerate={onRegenerate}
            busy={streaming}
            onEdit={onEdit}
            onSwitchBranch={onSwitchBranch}
          />
        );
      })}

      {live ? (
        <div className="flex gap-3.5">
          <Avatar active />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-[16px] leading-[1.75]">
              {live.text ? <Markdown>{live.text}</Markdown> : <ThinkingDots />}
              {live.text ? <span className="caret" aria-hidden /> : null}
            </div>
            <Sources citations={live.citations} content={live.text} />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{live.modelId ?? "Model"} · generating</span>
              <button type="button" onClick={onStop} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
                <Square className="size-3 fill-current" aria-hidden />
                Stop
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The small mark beside Omni's replies. It breathes while a reply is being written. */
function Avatar({ active = false }: { active?: boolean }) {
  return (
    <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10", active && "animate-breathe")} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-[18px] text-primary">
        <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="12" cy="12" r="3.6" fill="currentColor" />
      </svg>
    </span>
  );
}

function RememberButton({ content, inline = false }: { content: string; inline?: boolean }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function remember() {
    setState("saving");
    setError(null);
    try {
      await apiRequest("/api/memory", { json: { content: content.slice(0, 2000) } });
      setState("saved");
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save that.");
      setState("error");
    }
  }

  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", !inline && "px-1")}>
      <button
        type="button"
        onClick={() => void remember()}
        disabled={state === "saving" || state === "saved"}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground disabled:opacity-100"
      >
        {state === "saved" ? <Check className="size-3.5" aria-hidden /> : <BookMarked className="size-3.5" aria-hidden />}
        {state === "saved" ? "Saved to memory" : "Remember this"}
      </button>
      {error ? <span role="alert" className="text-danger">{error}</span> : null}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-2 py-1 text-sm text-muted-foreground" role="status">
      <span className="inline-flex gap-1" aria-hidden>
        <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/70" />
      </span>
      Thinking…
    </span>
  );
}

/** "‹ 2/3 ›": steps between the versions of a message made by editing or regenerating. */
function BranchSwitcher({ branch, onSwitch, disabled }: { branch: BranchInfo; onSwitch: (messageId: string) => void; disabled: boolean }) {
  if (branch.count < 2) return null;
  const go = (offset: number) => onSwitch(branch.ids[branch.index + offset]);
  return (
    <span className="inline-flex items-center gap-0.5" role="group" aria-label="Versions of this message">
      <button type="button" onClick={() => go(-1)} disabled={disabled || branch.index === 0} aria-label="Previous version" className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-30">
        <ChevronLeft className="size-3.5" aria-hidden />
      </button>
      <span className="num min-w-8 text-center">
        {branch.index + 1}/{branch.count}
      </span>
      <button type="button" onClick={() => go(1)} disabled={disabled || branch.index === branch.count - 1} aria-label="Next version" className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-30">
        <ChevronRight className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

function AttachmentList({ attachments }: { attachments: MessageDto["attachments"] }) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex max-w-full flex-wrap justify-end gap-2">
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <li key={attachment.id}>
            <a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- a protected, user-owned file; Next's optimizer isn't needed */}
              <img src={`/api/attachments/${attachment.id}`} alt={attachment.name} className="max-h-40 max-w-full rounded-lg border border-border object-cover" />
            </a>
          </li>
        ) : (
          <li key={attachment.id}>
            <a href={`/api/attachments/${attachment.id}`} download={attachment.name} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs hover:bg-accent">
              <FileText className="size-3.5" aria-hidden /> {attachment.name}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

function UserMessage({
  message,
  busy,
  onEdit,
  onSwitchBranch,
}: {
  message: MessageDto;
  busy: boolean;
  onEdit: (messageId: string, content: string) => void;
  onSwitchBranch: (messageId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (editing) {
    return (
      <div className="flex w-full flex-col items-end gap-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={Math.min(10, Math.max(3, draft.split("\n").length))}
          aria-label="Edit your message"
          className="w-full max-w-[90%] rounded-xl border border-ring bg-card p-3 text-[15px] leading-6 outline-none md:max-w-[80%]"
        />
        <p className="text-xs text-muted-foreground">Sending creates a new version. The original stays available.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
            Cancel
          </button>
          <button
            type="button"
            disabled={!draft.trim() && message.attachments.length === 0}
            onClick={() => {
              setEditing(false);
              onEdit(message.id, draft.trim());
            }}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Send new version
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end gap-1.5">
      <AttachmentList attachments={message.attachments} />
      {message.content ? (
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-[22px] rounded-br-lg bg-accent px-4.5 py-3 text-[16px] leading-7 md:max-w-[80%]">{message.content}</div>
      ) : null}
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <BranchSwitcher branch={message.branch} onSwitch={onSwitchBranch} disabled={busy} />
        <span className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Pencil className="size-3.5" aria-hidden /> Edit
          </button>
          {message.content ? <RememberButton content={message.content} inline /> : null}
        </span>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  showRegenerate,
  onRegenerate,
  busy,
  onEdit,
  onSwitchBranch,
}: {
  message: MessageDto;
  showRegenerate: boolean;
  onRegenerate: () => void;
  busy: boolean;
  onEdit: (messageId: string, content: string) => void;
  onSwitchBranch: (messageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (isUser) {
    return <UserMessage message={message} busy={busy} onEdit={onEdit} onSwitchBranch={onSwitchBranch} />;
  }

  const failed = message.status === "error";
  const stopped = message.status === "stopped";
  const streaming = message.status === "streaming";

  return (
    <div className="group flex gap-3.5">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-2">
        <div className={cn("text-[16px] leading-[1.75]", failed && "rounded-xl border border-danger/40 bg-danger/5 px-4 py-3")}>
          {message.content ? (
            <Markdown>{message.content}</Markdown>
          ) : streaming ? (
            <ThinkingDots />
          ) : failed ? null : (
            <p className="text-sm italic text-muted-foreground">Stopped before any text was generated.</p>
          )}

          {failed ? (
            <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{message.error ?? "The reply failed."}</span>
            </p>
          ) : null}
          {stopped && message.content ? <p className="mt-2 text-xs text-muted-foreground">Stopped. The partial reply was kept.</p> : null}
        </div>

        {message.citations?.length ? <Sources citations={message.citations} content={message.content} /> : null}

        {!streaming ? (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
            <BranchSwitcher branch={message.branch} onSwitch={onSwitchBranch} disabled={busy} />
            <span className="flex items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
              {message.content ? (
                <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy reply"} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground">
                  {copied ? <Check className="size-3.5 text-primary" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
              ) : null}
              {showRegenerate ? (
                <button type="button" onClick={onRegenerate} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground">
                  <RotateCcw className="size-3.5" aria-hidden />
                  {failed ? "Retry" : "Regenerate"}
                </button>
              ) : null}
              {message.content ? <RememberButton content={message.content} inline /> : null}
            </span>
            <span className="ml-1 truncate font-mono text-[11px] text-muted-foreground/80" title={message.modelId ?? "unknown model"}>
              {message.modelId ?? "unknown model"} · {usageSummary(message)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
