"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, BookOpen, Menu, Pencil, Search } from "lucide-react";
import { Composer } from "@/components/chat/composer";
import { describeError, useModelCatalog } from "@/components/chat/use-model-catalog";
import { LiveReply, Transcript } from "@/components/chat/transcript";
import { ChatMenu } from "@/components/chat/chat-menu";
import { SummaryDialog } from "@/components/chat/summary-dialog";
import { useStickToBottom } from "@/components/chat/use-stick-to-bottom";
import { ConnectHero, StarterGrid, WelcomeHero } from "@/components/chat/welcome";
import { ModelPicker } from "@/components/model-picker";
import { ThemeCycleButton } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { announce, NEW_CHAT_EVENT, OPEN_MENU_EVENT, OPEN_PALETTE_EVENT } from "@/lib/client/app-events";
import { apiRequest, isAbortError, streamTurn } from "@/lib/client/api";
import { addConversation, refreshConversations, renameConversationLocally } from "@/lib/client/conversations";
import { leaveChatDraft } from "@/lib/chat/draft";
import { formatTokens, formatUsd } from "@/lib/format";
import type { ConversationDetail, ConversationSummary, MessageDto, TurnEvent } from "@/lib/chat/types";
import { useModifierLabel } from "@/lib/client-hooks";
import { shouldSearchWeb, WEB_MODES, type WebMode } from "@/lib/chat/web";
import { cn } from "@/lib/utils";

const KNOWLEDGE_KEY = "omni.chat.useKnowledge";

/** Whether replies may draw on saved documents. Remembered in this browser; on by default. */
function useKnowledgeToggle(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable on the client
      if (window.localStorage.getItem(KNOWLEDGE_KEY) === "off") setValue(false);
    } catch {
      // Storage can be blocked; the default stays.
    }
  }, []);
  return [
    value,
    (next) => {
      setValue(next);
      try {
        window.localStorage.setItem(KNOWLEDGE_KEY, next ? "on" : "off");
      } catch {
        // Not remembered, still applied.
      }
    },
  ];
}

const WEB_KEY = "omni.chat.web";

/** Web search mode: automatic by default. Remembered in this browser. */
function useWebMode(): [WebMode, (value: WebMode) => void] {
  const [value, setValue] = useState<WebMode>("auto");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(WEB_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable on the client
      if (saved && (WEB_MODES as readonly string[]).includes(saved)) setValue(saved as WebMode);
    } catch {
      // Storage can be blocked; the default stays.
    }
  }, []);
  return [
    value,
    (next) => {
      setValue(next);
      try {
        window.localStorage.setItem(WEB_KEY, next);
      } catch {
        // Not remembered, still applied.
      }
    },
  ];
}

type ConversationResponse = { conversation: ConversationDetail };

export function ChatWorkspace({ initialId }: { initialId: string | null }) {
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const activeIdRef = useRef<string | null>(initialId);
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
  const [useKnowledge, setUseKnowledge] = useKnowledgeToggle();
  const [webMode, setWebMode] = useWebMode();
  const searchingRef = useRef(false);
  const liveTextRef = useRef("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Set while an edited message is being sent, so the screen shows the new version in place of the old.
  const replacingRef = useRef<string | null>(null);

  const catalog = useModelCatalog();
  const { settings, models } = catalog;
  const current = detail && detail.id === activeId ? detail : null;
  const keyConfigured = settings?.apiKey.configured ?? false;
  const selectedModel = models.find((model) => model.id === (current?.modelId ?? pendingModelId ?? settings?.defaultModelId ?? null)) ?? null;
  const selectedModelId = current?.modelId ?? pendingModelId ?? settings?.defaultModelId ?? null;

  const loadConversations = useCallback(async () => {
    await refreshConversations();
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

  function startNewChat() {
    abortRef.current?.abort();
    activeIdRef.current = null;
    setActiveId(null);
    setDetail(null);
    setLive(null);
    setBanner(null);
    setEditingTitle(false);
    setSystemOpen(false);
    window.history.pushState(null, "", "/");
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus());
  }

  // "New chat" in the sidebar, the command bar and the keyboard all arrive as this one signal.
  const startNewChatRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    startNewChatRef.current = startNewChat;
  });
  useEffect(() => {
    const onNewChat = () => startNewChatRef.current();
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, []);

  function handleTurnEvent(conversationId: string, event: TurnEvent) {
    switch (event.type) {
      case "start":
        setLive({ text: "", modelId: event.modelId, citations: event.citations ?? [], searching: searchingRef.current });
        if (event.userMessage) {
          const userMessage: MessageDto = event.userMessage;
          const replacing = replacingRef.current;
          setDetail((prev) => {
            if (!prev || prev.id !== conversationId) return prev;
            const at = replacing ? prev.messages.findIndex((message) => message.id === replacing) : -1;
            return { ...prev, messages: [...(at >= 0 ? prev.messages.slice(0, at) : prev.messages), userMessage] };
          });
        }
        break;
      case "delta":
        liveTextRef.current += event.text;
        setLive((prev) => (prev ? { ...prev, text: prev.text + event.text } : prev));
        break;
      case "web":
        setLive((prev) => (prev ? { ...prev, citations: event.citations } : prev));
        break;
      default:
        break;
    }
  }

  async function runTurn(kind: "send" | "regenerate", content?: string, options: { attachmentIds?: string[]; replaceMessageId?: string } = {}) {
    replacingRef.current = options.replaceMessageId ?? null;
    searchingRef.current = shouldSearchWeb(content ?? "", webMode);
    liveTextRef.current = "";
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
        addConversation(created.conversation);
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
      await streamTurn(path, kind === "send" ? { content, useKnowledge, web: webMode, attachmentIds: options.attachmentIds, replaceMessageId: options.replaceMessageId } : { useKnowledge, web: webMode }, {
        signal: controller.signal,
        onEvent: (event) => handleTurnEvent(conversationId as string, event),
      });
    } catch (error) {
      if (!isAbortError(error)) setBanner(describeError(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      // Let the last words finish flowing in before the finished message takes over.
      if (liveTextRef.current) await new Promise((resolve) => setTimeout(resolve, 380));
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

  async function switchBranch(messageId: string) {
    const id = activeIdRef.current;
    if (!id) return;
    try {
      await apiRequest(`/api/conversations/${id}/branch`, { json: { messageId } });
      await reloadConversation(id, false);
    } catch (error) {
      setBanner(describeError(error));
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
      renameConversationLocally(id, conversation.title);
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
  const loadingConversation = activeId !== null && !current;
  // The welcome screen shows for a brand-new chat; as soon as there is something to read, the message box drops to the bottom.
  const welcome = !hasMessages && !streaming && !loadingConversation;
  const modifier = useModifierLabel();
  const follow = `${current?.messages.length ?? 0}:${live?.text.length ?? 0}:${streaming}`;
  const { scroller, onScroll, away, scrollToBottom } = useStickToBottom(follow);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1.5 px-3 sm:px-5">
        <button
          type="button"
          onClick={() => announce(OPEN_MENU_EVENT)}
          aria-label="Open navigation"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
              className="h-8 min-w-0 max-w-md flex-1 rounded-lg border border-ring bg-card px-2.5 text-sm font-medium outline-none"
            />
          ) : current ? (
            <>
              <h2 className="truncate text-sm font-medium">{current.title}</h2>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(current.title);
                  setEditingTitle(true);
                }}
                aria-label="Rename conversation"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              {current.usage.requests > 0 ? (
                <span
                  className="num ml-1 hidden truncate text-xs text-muted-foreground lg:inline"
                  title={current.usage.unknownCostRequests > 0 ? `${current.usage.unknownCostRequests} request(s) have no cost data` : "Cost reported by OpenRouter or estimated from model pricing"}
                >
                  {current.usage.totalTokens > 0 ? `${formatTokens(current.usage.totalTokens)} tokens · ${formatUsd(current.usage.costUsd)}` : "Usage unavailable"}
                </span>
              ) : null}
            </>
          ) : (
            <h2 className="hidden text-sm font-medium text-muted-foreground sm:block">New chat</h2>
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

        <button
          type="button"
          onClick={() => setUseKnowledge(!useKnowledge)}
          aria-pressed={useKnowledge}
          title={useKnowledge ? "Replies can use your saved documents. Click to turn off." : "Replies won't look at your documents. Click to turn on."}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-sm:hidden", useKnowledge ? "text-primary" : "text-muted-foreground")}
        >
          <BookOpen className="size-4" aria-hidden />
          <span className="hidden lg:inline">Knowledge {useKnowledge ? "on" : "off"}</span>
        </button>

        <ChatMenu
          conversationId={current?.id ?? null}
          hasMessages={hasMessages}
          hasInstructions={Boolean(current?.systemPrompt)}
          onSummarize={() => setSummaryOpen(true)}
          onInstructions={() => {
            setSystemDraft(current?.systemPrompt ?? "");
            setSystemOpen((open) => !open);
          }}
        />

        <button
          type="button"
          onClick={() => announce(OPEN_PALETTE_EVENT)}
          aria-label="Open command palette"
          title={`Search everything (${modifier}K)`}
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-sm:hidden"
        >
          <Search className="size-4" aria-hidden />
        </button>
        <span className="max-sm:hidden">
          <ThemeCycleButton />
        </span>
      </header>

      {current && systemOpen ? (
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <SystemPromptPanel
            value={systemDraft}
            onChange={setSystemDraft}
            onSave={() => void saveSystemPrompt(systemDraft.trim() || null)}
            onClose={() => setSystemOpen(false)}
          />
        </div>
      ) : null}

      {banner ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-2 sm:px-6">
          <div role="alert" className="rounded-xl border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
            {banner}
          </div>
        </div>
      ) : null}

      {/* The scrolling conversation. On the welcome screen it holds the greeting, and the message box and ideas follow it, so the
          whole group sits in the middle of the window; once there are messages the box is pinned to the bottom. */}
      <div ref={scroller} onScroll={onScroll} className={cn("min-h-0 overflow-y-auto", welcome ? "flex flex-1 flex-col justify-end" : "flex-1")}>
        {welcome ? (
          <WelcomeHero ready={!settings || keyConfigured} />
        ) : loadingConversation ? (
          <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6" role="status" aria-label="Loading conversation">
            {[0, 1].map((index) => (
              <div key={index} className="flex gap-3.5">
                <span className="skeleton size-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2.5 pt-1.5">
                  <div className="skeleton h-3.5 w-11/12 rounded" />
                  <div className="skeleton h-3.5 w-4/5 rounded" />
                  <div className="skeleton h-3.5 w-2/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6 sm:px-6">
            <Transcript
              messages={current?.messages ?? []}
              live={live}
              streaming={streaming}
              canRegenerate={canRegenerate}
              onRegenerate={() => void runTurn("regenerate")}
              onStop={() => abortRef.current?.abort()}
              onEdit={(messageId, content) => void runTurn("send", content, { replaceMessageId: messageId })}
              onSwitchBranch={(messageId) => void switchBranch(messageId)}
            />
          </div>
        )}
        {!hasMessages && streaming && !live ? <p className="mx-auto w-full max-w-3xl px-6 text-sm text-muted-foreground">Starting…</p> : null}
      </div>

      {away && !welcome ? (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label="Jump to latest message"
          className="animate-pop-in absolute bottom-36 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
      ) : null}

      {settings ? (
        <div className={cn("shrink-0", welcome ? "" : "chat-fade-bottom pt-2")}>
          {settings && !keyConfigured && welcome ? <ConnectHero /> : null}
          <Composer
            onSend={(content, attachmentIds) => {
              scrollToBottom();
              void runTurn("send", content, { attachmentIds });
            }}
            onNewChat={startNewChat}
            web={webMode}
            onWebChange={setWebMode}
            canReadImages={selectedModel ? selectedModel.capabilities.imageInput : true}
            modelName={selectedModel?.name}
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
        </div>
      ) : null}

      {welcome ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <StarterGrid disabled={!keyConfigured} onPick={(prompt) => leaveChatDraft(prompt)} />
        </div>
      ) : null}

      {summaryOpen && current ? <SummaryDialog conversationId={current.id} title={current.title} onClose={() => setSummaryOpen(false)} /> : null}
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
    <div className="mt-2 space-y-2 rounded-2xl border border-border bg-card p-3.5">
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
