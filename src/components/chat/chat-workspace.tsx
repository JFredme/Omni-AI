"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, ScrollText } from "lucide-react";
import { ConversationList } from "@/components/chat/conversation-list";
import { Composer } from "@/components/chat/composer";
import { describeError, useModelCatalog } from "@/components/chat/use-model-catalog";
import { LiveReply, Transcript } from "@/components/chat/transcript";
import { ModelPicker } from "@/components/model-picker";
import { buttonVariants } from "@/components/ui/button";
import { apiRequest, isAbortError, streamTurn } from "@/lib/client/api";
import { formatTokens, formatUsd } from "@/lib/format";
import type { ConversationDetail, ConversationSummary, MessageDto, TurnEvent } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Help me plan a focused study session for this week.",
  "Explain a tricky concept in simple terms, then quiz me on it.",
  "Draft a polite email declining a meeting, with two alternative times.",
];

type ConversationResponse = { conversation: ConversationDetail };

export function ChatWorkspace({ initialId }: { initialId: string | null }) {
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const activeIdRef = useRef<string | null>(initialId);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveReply | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);
  const [systemDraft, setSystemDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const catalog = useModelCatalog();
  const { settings, models } = catalog;
  const current = detail && detail.id === activeId ? detail : null;
  const keyConfigured = settings?.apiKey.configured ?? false;
  const selectedModelId = current?.modelId ?? pendingModelId ?? settings?.defaultModelId ?? null;

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiRequest<{ conversations: ConversationSummary[] }>("/api/conversations");
      setConversations(data.conversations);
    } catch (error) {
      setBanner(describeError(error));
    }
  }, []);

  const reloadConversation = useCallback(async (id: string, waitForSettled: boolean) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { conversation } = await apiRequest<ConversationResponse>(`/api/conversations/${id}`);
      const settling = conversation.messages.some((message) => message.status === "streaming");
      if (activeIdRef.current === id) setDetail(conversation);
      if (!waitForSettled || !settling) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<{ conversations: ConversationSummary[] }>("/api/conversations")
      .then((data) => {
        if (active) setConversations(data.conversations);
      })
      .catch((error: unknown) => {
        if (active) setBanner(describeError(error));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    apiRequest<ConversationResponse>(`/api/conversations/${activeId}`)
      .then(({ conversation }) => {
        if (!cancelled) setDetail(conversation);
      })
      .catch((error: unknown) => {
        if (!cancelled) setBanner(describeError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  function selectConversation(id: string) {
    if (id === activeIdRef.current) return;
    abortRef.current?.abort();
    activeIdRef.current = id;
    setActiveId(id);
    setLive(null);
    setBanner(null);
    setEditingTitle(false);
    setSystemOpen(false);
    window.history.pushState(null, "", `/chat/${id}`);
  }

  function startNewChat() {
    abortRef.current?.abort();
    activeIdRef.current = null;
    setActiveId(null);
    setDetail(null);
    setLive(null);
    setBanner(null);
    setEditingTitle(false);
    setSystemOpen(false);
    window.history.pushState(null, "", "/chat");
  }

  async function deleteConversation(id: string) {
    try {
      await apiRequest(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev?.filter((conversation) => conversation.id !== id) ?? null);
      if (activeIdRef.current === id) startNewChat();
    } catch (error) {
      setBanner(describeError(error));
    }
  }

  function handleTurnEvent(conversationId: string, event: TurnEvent) {
    switch (event.type) {
      case "start":
        setLive({ text: "", modelId: event.modelId });
        if (event.userMessage) {
          const userMessage: MessageDto = event.userMessage;
          setDetail((prev) =>
            prev && prev.id === conversationId ? { ...prev, messages: [...prev.messages, userMessage] } : prev,
          );
        }
        break;
      case "delta":
        setLive((prev) => (prev ? { ...prev, text: prev.text + event.text } : prev));
        break;
      default:
        break;
    }
  }

  async function runTurn(kind: "send" | "regenerate", content?: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setBanner(null);
    let conversationId = activeIdRef.current;

    try {
      if (!conversationId) {
        const created = await apiRequest<{ conversation: ConversationSummary }>("/api/conversations", {
          json: { modelId: pendingModelId ?? undefined },
          signal: controller.signal,
        });
        conversationId = created.conversation.id;
        activeIdRef.current = conversationId;
        setActiveId(conversationId);
        setConversations((prev) => [created.conversation, ...(prev ?? [])]);
        window.history.replaceState(null, "", `/chat/${conversationId}`);
        await reloadConversation(conversationId, false);
      }

      if (kind === "regenerate") {
        setDetail((prev) => {
          if (!prev || prev.id !== conversationId) return prev;
          const lastAssistant = [...prev.messages].reverse().find((message) => message.role === "assistant");
          return {
            ...prev,
            messages: prev.messages.filter((message) => message.id !== lastAssistant?.id),
          };
        });
      }

      const path = `/api/conversations/${conversationId}/${kind === "send" ? "messages" : "regenerate"}`;
      await streamTurn(path, kind === "send" ? { content } : {}, {
        signal: controller.signal,
        onEvent: (event) => handleTurnEvent(conversationId as string, event),
      });
    } catch (error) {
      if (!isAbortError(error)) setBanner(describeError(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLive(null);
      setStreaming(false);
      if (conversationId) {
        try {
          await reloadConversation(conversationId, true);
        } catch (error) {
          setBanner(describeError(error));
        }
      }
      await loadConversations();
    }
  }

  async function changeModel(modelId: string) {
    if (!activeIdRef.current) {
      setPendingModelId(modelId);
      return;
    }
    const id = activeIdRef.current;
    setDetail((prev) => (prev && prev.id === id ? { ...prev, modelId } : prev));
    try {
      const { conversation } = await apiRequest<ConversationResponse>(`/api/conversations/${id}`, {
        method: "PATCH",
        json: { modelId },
      });
      if (activeIdRef.current === id) setDetail(conversation);
    } catch (error) {
      setBanner(describeError(error));
      await reloadConversation(id, false).catch(() => undefined);
    }
  }

  async function saveTitle() {
    setEditingTitle(false);
    const id = activeIdRef.current;
    const title = titleDraft.trim();
    if (!id || !current || !title || title === current.title) return;
    try {
      const { conversation } = await apiRequest<ConversationResponse>(`/api/conversations/${id}`, {
        method: "PATCH",
        json: { title },
      });
      if (activeIdRef.current === id) setDetail(conversation);
      await loadConversations();
    } catch (error) {
      setBanner(describeError(error));
    }
  }

  async function saveSystemPrompt(value: string | null) {
    const id = activeIdRef.current;
    if (!id) return;
    try {
      const { conversation } = await apiRequest<ConversationResponse>(`/api/conversations/${id}`, {
        method: "PATCH",
        json: { systemPrompt: value },
      });
      if (activeIdRef.current === id) setDetail(conversation);
      setSystemOpen(false);
    } catch (error) {
      setBanner(describeError(error));
    }
  }

  const lastMessage = current?.messages.at(-1);
  const canRegenerate = Boolean(
    current && lastMessage && (lastMessage.role === "user" || lastMessage.role === "assistant"),
  );
  const hasMessages = (current?.messages.length ?? 0) > 0;

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[32rem] flex-col gap-4 md:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col rounded-2xl border border-border p-3 md:flex">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          loading={conversations === null}
          onNew={startNewChat}
          onSelect={selectConversation}
          onDelete={deleteConversation}
        />
      </aside>

      <details className="shrink-0 rounded-2xl border border-border p-3 md:hidden">
        <summary className="cursor-pointer text-sm font-medium">
          Conversations{conversations ? ` (${conversations.length})` : ""}
        </summary>
        <div className="mt-3 flex max-h-72 flex-col">
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            loading={conversations === null}
            onNew={startNewChat}
            onSelect={selectConversation}
            onDelete={deleteConversation}
          />
        </div>
      </details>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {current && editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveTitle();
                  if (event.key === "Escape") setEditingTitle(false);
                }}
                maxLength={120}
                aria-label="Conversation title"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm font-semibold outline-none focus:border-ring"
              />
            ) : (
              <>
                <h2 className="truncate text-sm font-semibold">{current?.title ?? "New chat"}</h2>
                {current ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTitleDraft(current.title);
                      setEditingTitle(true);
                    }}
                    aria-label="Rename conversation"
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </>
            )}
          </div>

          {keyConfigured ? (
            <ModelPicker
              models={models}
              value={selectedModelId}
              favoriteIds={settings?.favoriteModelIds ?? []}
              onSelect={changeModel}
              onToggleFavorite={(modelId) => {
                void catalog.toggleFavorite(modelId).catch((error: unknown) => setBanner(describeError(error)));
              }}
              loading={catalog.modelsLoading}
              loadError={catalog.modelsError}
              disabled={streaming}
              align="right"
            />
          ) : null}

          {current ? (
            <button
              type="button"
              onClick={() => {
                setSystemDraft(current.systemPrompt ?? "");
                setSystemOpen((open) => !open);
              }}
              aria-expanded={systemOpen}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                current.systemPrompt && "text-accent-foreground",
              )}
            >
              <ScrollText className="size-4" aria-hidden />
              Instructions
            </button>
          ) : null}

          {current && current.usage.requests > 0 ? (
            <span
              className="text-xs text-muted-foreground"
              title={
                current.usage.unknownCostRequests > 0
                  ? `${current.usage.unknownCostRequests} request(s) have no cost data`
                  : "Cost reported by OpenRouter or estimated from model pricing"
              }
            >
              {current.usage.totalTokens > 0
                ? `${formatTokens(current.usage.totalTokens)} tokens · ${formatUsd(current.usage.costUsd)}`
                : "Usage unavailable"}
            </span>
          ) : null}
        </header>

        {current && systemOpen ? (
          <SystemPromptPanel
            value={systemDraft}
            onChange={setSystemDraft}
            onSave={() => void saveSystemPrompt(systemDraft.trim() || null)}
            onClose={() => setSystemOpen(false)}
          />
        ) : null}

        {banner ? (
          <div role="alert" className="mx-4 mt-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {banner}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {settings && !keyConfigured ? (
            <EmptyState
              title="Connect OpenRouter to start chatting"
              body="Add your OpenRouter API key in Settings. It is encrypted before it is stored, and it never leaves the server."
              action={
                <Link href="/settings" className={buttonVariants({ variant: "primary" })}>
                  Open settings
                </Link>
              }
            />
          ) : !current && !streaming ? (
            <EmptyState
              title="What would you like to work on?"
              body="Start a conversation with any model on OpenRouter. Replies stream in as they are generated, and every conversation is saved."
              action={
                <div className="flex w-full flex-col">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void runTurn("send", suggestion)}
                      disabled={!selectedModelId}
                      className="border-t border-border py-3 text-left text-sm transition-colors hover:text-primary disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                  {!selectedModelId && models.length > 0 ? (
                    <p className="text-xs text-muted-foreground">Choose a model above to get started.</p>
                  ) : null}
                </div>
              }
            />
          ) : (
            <Transcript
              messages={current?.messages ?? []}
              live={live}
              streaming={streaming}
              canRegenerate={canRegenerate}
              onRegenerate={() => void runTurn("regenerate")}
              onStop={() => abortRef.current?.abort()}
            />
          )}
          {!hasMessages && streaming && !live ? <p className="text-sm text-muted-foreground">Starting…</p> : null}
        </div>

        {settings ? (
          <Composer
            onSend={(content) => void runTurn("send", content)}
            onStop={() => abortRef.current?.abort()}
            streaming={streaming}
            disabled={!keyConfigured || !selectedModelId}
            disabledReason={
              !keyConfigured
                ? "Add an OpenRouter API key in Settings to send messages."
                : !selectedModelId
                  ? "Choose a model to send messages."
                  : undefined
            }
          />
        ) : null}
      </section>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-full min-h-64 max-w-xl flex-col justify-center gap-5">
      <div className="space-y-2">
        <h3 className="font-display text-3xl font-medium leading-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

function SystemPromptPanel({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mx-4 mt-3 space-y-2 rounded-xl border border-border bg-card p-3">
      <label htmlFor="system-prompt" className="text-sm font-medium">
        Instructions for this conversation
      </label>
      <textarea
        id="system-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        maxLength={8000}
        placeholder="For example: Answer concisely and use metric units."
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Cancel
        </button>
        <button type="button" onClick={onSave} className={buttonVariants({ variant: "primary", size: "sm" })}>
          Save instructions
        </button>
      </div>
    </div>
  );
}
