"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, RotateCcw, Square } from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { formatTokens, formatUsd } from "@/lib/format";
import type { MessageDto } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

export interface LiveReply {
  text: string;
  modelId: string | null;
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
}: {
  messages: MessageDto[];
  live: LiveReply | null;
  streaming: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onStop: () => void;
}) {
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;

  return (
    <div className="space-y-6">
      {messages.map((message) => {
        if (message.role === "assistant" && message.status === "streaming" && live) return null;
        return (
          <MessageBubble
            key={message.id}
            message={message}
            showRegenerate={canRegenerate && !streaming && message.id === lastAssistantId}
            onRegenerate={onRegenerate}
          />
        );
      })}

      {live ? (
        <div className="flex flex-col items-start gap-1.5">
          <div className="max-w-full rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-foreground md:max-w-[85%]">
            {live.text ? <Markdown>{live.text}</Markdown> : <ThinkingDots />}
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-foreground align-middle" aria-hidden />
          </div>
          <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
            <span>{live.modelId ?? "Model"} · generating</span>
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
            >
              <Square className="size-3 fill-current" aria-hidden />
              Stop
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      Thinking…
    </span>
  );
}

function MessageBubble({
  message,
  showRegenerate,
  onRegenerate,
}: {
  message: MessageDto;
  showRegenerate: boolean;
  onRegenerate: () => void;
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
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary/15 px-4 py-3 text-[15px] leading-7 md:max-w-[80%]">
          {message.content}
        </div>
      </div>
    );
  }

  const failed = message.status === "error";
  const stopped = message.status === "stopped";
  const streaming = message.status === "streaming";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div
        className={cn(
          "max-w-full rounded-2xl rounded-bl-sm border px-4 py-3 md:max-w-[85%]",
          failed ? "border-danger/40 bg-danger/5" : "border-border bg-card",
        )}
      >
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
        {stopped && message.content ? (
          <p className="mt-2 text-xs text-muted-foreground">Stopped. The partial reply was kept.</p>
        ) : null}
      </div>

      {!streaming ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <span className="font-mono">{message.modelId ?? "unknown model"}</span>
          <span>·</span>
          <span>{usageSummary(message)}</span>
          {message.content ? (
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Copied" : "Copy reply"}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
          {showRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {failed ? "Retry" : "Regenerate"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
