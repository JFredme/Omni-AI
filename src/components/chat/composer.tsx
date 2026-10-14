"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CHAT_DRAFT_EVENT, CHAT_DRAFT_KEY } from "@/lib/chat/draft";
import { ArrowUp, FileText, Image as ImageIcon, Loader2, Paperclip, Square, X } from "lucide-react";
import type { AttachmentDto } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const MAX_ATTACHMENTS = 5;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.csv,.md,.txt,.json,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.html,.css,.sql,.yaml,.yml";

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  disabledReason,
  placeholder = "Message OMNI AI…",
  canReadImages = true,
  modelName,
}: {
  onSend: (content: string, attachmentIds: string[]) => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  disabledReason?: string;
  placeholder?: string;
  /** False when the chosen model can't take images; image files are then refused with a reason. */
  canReadImages?: boolean;
  modelName?: string;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  const [uploading, setUploading] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // The command bar's "Ask AI" leaves a draft here. It fills the box but is never sent for you.
  useEffect(() => {
    function takeDraft() {
      try {
        const draft = sessionStorage.getItem(CHAT_DRAFT_KEY);
        if (!draft) return;
        sessionStorage.removeItem(CHAT_DRAFT_KEY);
        setValue(draft);
        textareaRef.current?.focus();
      } catch {
        // Storage can be blocked; the box just stays empty.
      }
    }
    takeDraft();
    window.addEventListener(CHAT_DRAFT_EVENT, takeDraft);
    return () => window.removeEventListener(CHAT_DRAFT_EVENT, takeDraft);
  }, []);
  const fileInput = useRef<HTMLInputElement | null>(null);

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
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }

  function submit() {
    const content = value.trim();
    if ((!content && attachments.length === 0) || disabled || streaming || uploading > 0) return;
    onSend(content, attachments.map((attachment) => attachment.id));
    setValue("");
    setAttachments([]);
    setAttachError(null);
    requestAnimationFrame(resize);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="space-y-2 border-t border-border p-3">
      {disabled && disabledReason ? <p className="px-1 text-xs text-muted-foreground">{disabledReason}</p> : null}
      {attachments.length > 0 || uploading > 0 ? (
        <ul aria-label="Attached files" className="flex flex-wrap gap-2 px-1">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-muted/50 py-1 pr-1 pl-2 text-xs">
              {attachment.kind === "image" ? <ImageIcon className="size-3.5 shrink-0" aria-hidden /> : <FileText className="size-3.5 shrink-0" aria-hidden />}
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
        <p role="alert" className="px-1 text-xs text-danger">
          {attachError}
        </p>
      ) : null}
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
          "flex items-end gap-2 rounded-2xl border border-border bg-card p-2 transition-colors focus-within:border-ring",
          dragging && "border-primary bg-accent/40",
          disabled && "opacity-60",
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
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled || streaming || attachments.length >= MAX_ATTACHMENTS}
          aria-label="Attach files"
          title={canReadImages ? "Attach images or documents" : "Attach documents (this model can't read images)"}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Paperclip className="size-4" aria-hidden />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          className="max-h-[220px] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity hover:opacity-85"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || uploading > 0 || (value.trim().length === 0 && attachments.length === 0)}
            aria-label="Send message"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
    </div>
  );
}
