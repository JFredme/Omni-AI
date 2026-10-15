"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, ArrowUp, Check, FileText, Image as ImageIcon, Loader2, Paperclip, Slash, Square, X } from "lucide-react";
import { SlashMenu } from "@/components/chat/slash-menu";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { CHAT_DRAFT_EVENT, CHAT_DRAFT_KEY } from "@/lib/chat/draft";
import { matchSlash, parseSlash, SLASH_COMMANDS, type SlashCommand } from "@/lib/chat/slash";
import type { AttachmentDto } from "@/lib/chat/types";
import { useModifierLabel } from "@/lib/client-hooks";
import { cn } from "@/lib/utils";

const MAX_ATTACHMENTS = 5;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.csv,.md,.txt,.json,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.html,.css,.sql,.yaml,.yml";

interface Notice {
  kind: "ok" | "error";
  text: string;
  href?: string;
  linkLabel?: string;
}

export function Composer({
  onSend,
  onStop,
  onNewChat,
  streaming,
  disabled,
  disabledReason,
  placeholder = "Ask anything, or type / for commands",
  canReadImages = true,
  modelName,
}: {
  onSend: (content: string, attachmentIds: string[]) => void;
  onStop: () => void;
  onNewChat: () => void;
  streaming: boolean;
  disabled: boolean;
  disabledReason?: string;
  placeholder?: string;
  /** False when the chosen model can't take images; image files are then refused with a reason. */
  canReadImages?: boolean;
  modelName?: string;
}) {
  const router = useRouter();
  const modifier = useModifierLabel();
  const menuId = useId();
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  const [uploading, setUploading] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const suggestions = menuClosed ? null : matchSlash(value);

  // Other parts of the app leave a draft here (the command bar, the suggestion cards). It fills the box but is never sent for you.
  useEffect(() => {
    function takeDraft() {
      try {
        const draft = sessionStorage.getItem(CHAT_DRAFT_KEY);
        if (!draft) return;
        sessionStorage.removeItem(CHAT_DRAFT_KEY);
        setValue(draft);
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
          resize();
        });
      } catch {
        // Storage can be blocked; the box just stays empty.
      }
    }
    takeDraft();
    window.addEventListener(CHAT_DRAFT_EVENT, takeDraft);
    return () => window.removeEventListener(CHAT_DRAFT_EVENT, takeDraft);
  }, []);

  // A notice about a command fades on its own, unless it's an error you may want to read again.
  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Typing anywhere on the page (that isn't a field) starts a message, like a messaging app.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable], [role='dialog']") || target.tagName === "BUTTON" || target.tagName === "A")) return;
      textareaRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  async function attach(files: File[]) {
    setAttachError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (files.length > room) setAttachError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      if (!canReadImages && /^image\//.test(file.type)) {
        setAttachError(`${modelName ?? "This model"} can't read images. Choose a model that supports image input.`);
        continue;
      }
      setUploading((count) => count + 1);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/attachments", { method: "POST", body: form });
        const data = (await response.json().catch(() => null)) as { attachment?: AttachmentDto; error?: { message?: string } } | null;
        if (!response.ok || !data?.attachment) throw new Error(data?.error?.message ?? `Couldn't attach ${file.name}.`);
        setAttachments((prev) => [...prev, data.attachment!]);
      } catch (error) {
        setAttachError(error instanceof Error ? error.message : `Couldn't attach ${file.name}.`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  function resize() {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }

  function clear() {
    setValue("");
    setAttachments([]);
    setAttachError(null);
    setMenuClosed(false);
    requestAnimationFrame(resize);
  }

  async function runCommand(command: SlashCommand, text: string) {
    try {
      if (command.name === "new") {
        onNewChat();
      } else if (command.href) {
        router.push(command.href);
      } else if (command.name === "task") {
        await apiRequest("/api/tasks", { json: { title: text.slice(0, 200) } });
        setNotice({ kind: "ok", text: `Task added: ${text.slice(0, 60)}`, href: "/tasks", linkLabel: "View tasks" });
      } else if (command.name === "note") {
        const made = await apiRequest<{ note: { id: string } }>("/api/notes", { json: { title: text.split("\n")[0].slice(0, 80), content: text } });
        setNotice({ kind: "ok", text: "Note saved", href: `/notes/${made.note.id}`, linkLabel: "Open note" });
      } else if (command.name === "remember") {
        await apiRequest("/api/memory", { json: { content: text.slice(0, 2000) } });
        setNotice({ kind: "ok", text: "Saved to memory. Future chats can use it.", href: "/knowledge", linkLabel: "Manage memory" });
      }
      clear();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof ClientApiError ? error.message : "That didn't work. Try again." });
    }
  }

  function pick(command: SlashCommand) {
    if (command.argument) {
      setValue(`/${command.name} `);
      setMenuClosed(false);
      setMenuIndex(0);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        resize();
      });
    } else {
      void runCommand(command, "");
    }
  }

  function submit() {
    const content = value.trim();
    if (streaming || uploading > 0) return;

    const slash = parseSlash(content);
    if (slash) {
      void runCommand(slash.command, slash.text);
      return;
    }
    const bare = /^\/([a-z]+)$/i.exec(content);
    const needsText = bare ? SLASH_COMMANDS.find((command) => command.name === bare[1].toLowerCase() && command.argument) : undefined;
    if (needsText) {
      setNotice({ kind: "error", text: `Add what you want after the command, like /${needsText.name} ${needsText.argument}.` });
      return;
    }

    if (!content && attachments.length === 0) return;
    if (disabled) {
      setNotice({ kind: "error", text: disabledReason ?? "Choose a model to send messages." });
      return;
    }
    onSend(content, attachments.map((attachment) => attachment.id));
    clear();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMenuIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMenuIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuClosed(true);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        const chosen = suggestions[Math.min(menuIndex, suggestions.length - 1)];
        if (chosen) pick(chosen);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && streaming) {
      onStop();
    }
  }

  const canSend = value.trim().length > 0 || attachments.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      {disabled && disabledReason ? <p className="mb-2 px-2 text-xs text-muted-foreground">{disabledReason}</p> : null}

      <div aria-live="polite" className="empty:hidden">
        {notice ? (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={cn(
              "animate-pop-in mb-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
              notice.kind === "error" ? "border-danger/40 bg-danger/5 text-danger" : "border-border bg-card text-foreground",
            )}
          >
            {notice.kind === "error" ? <AlertCircle className="size-4 shrink-0" aria-hidden /> : <Check className="size-4 shrink-0 text-primary" aria-hidden />}
            <span className="min-w-0 flex-1 truncate">{notice.text}</span>
            {notice.href ? (
              <Link href={notice.href} className="shrink-0 text-primary underline-offset-2 hover:underline">
                {notice.linkLabel ?? "Open"}
              </Link>
            ) : null}
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      {attachments.length > 0 || uploading > 0 ? (
        <ul aria-label="Attached files" className="mb-2 flex flex-wrap gap-2 px-1">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex max-w-56 items-center gap-1.5 rounded-lg border border-border bg-card py-1 pr-1 pl-2.5 text-xs">
              {attachment.kind === "image" ? <ImageIcon className="size-3.5 shrink-0 text-primary" aria-hidden /> : <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />}
              <span className="truncate">{attachment.name}</span>
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))} aria-label={`Remove ${attachment.name}`} className="rounded p-0.5 hover:bg-accent">
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
          {uploading > 0 ? (
            <li role="status" className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Attaching…
            </li>
          ) : null}
        </ul>
      ) : null}
      {attachError ? (
        <p role="alert" className="mb-2 px-2 text-xs text-danger">
          {attachError}
        </p>
      ) : null}

      <div className="relative">
        {suggestions ? <SlashMenu id={menuId} commands={suggestions} activeIndex={Math.min(menuIndex, suggestions.length - 1)} onHover={setMenuIndex} onPick={pick} /> : null}
        <div
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void attach(Array.from(event.dataTransfer.files));
          }}
          className={cn(
            "composer-surface rounded-[28px] border border-border bg-card transition-[border-color,box-shadow] duration-200 focus-within:border-primary/50",
            dragging && "border-primary bg-accent/40",
          )}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={canReadImages ? ACCEPT : ACCEPT.replace(/\.(png|jpg|jpeg|webp|gif),/g, "")}
            aria-label="Attach files"
            onChange={(event) => {
              void attach(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={placeholder}
            aria-label="Message"
            aria-controls={suggestions ? menuId : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setMenuClosed(false);
              setMenuIndex(0);
              resize();
            }}
            onKeyDown={handleKeyDown}
            className="block max-h-60 min-h-[3.25rem] w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[16px] leading-6 outline-none placeholder:text-muted-foreground/80"
          />
          <div className="flex items-center gap-1 px-3 pb-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={streaming || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Attach files"
              title={canReadImages ? "Attach images or documents" : "Attach documents (this model can't read images)"}
              className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <Paperclip className="size-[18px]" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setValue((current) => (current.trim() === "" ? "/" : current));
                setMenuClosed(false);
                textareaRef.current?.focus();
              }}
              aria-label="Commands"
              title="Commands: add a task or note, or go anywhere"
              className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Slash className="size-[17px]" aria-hidden />
            </button>
            <span className="ml-auto hidden pr-2 text-[11.5px] text-muted-foreground/80 sm:inline">
              {streaming ? "Esc to stop" : `Enter to send · Shift+Enter for a new line`}
            </span>
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="grid size-9 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
              >
                <Square className="size-3.5 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={uploading > 0 || !canSend}
                aria-label="Send message"
                className={cn(
                  "grid size-9 place-items-center rounded-full transition-[background-color,color,transform] active:scale-95 sm:ml-0 ml-auto",
                  canSend ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground",
                )}
              >
                <ArrowUp className="size-[18px]" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="px-3 pb-3 pt-2 text-center text-[11.5px] text-muted-foreground/80">
        {modelName ? <>Replying with {modelName}. </> : null}
        Press {modifier}K to search everything.
      </p>
    </div>
  );
}
