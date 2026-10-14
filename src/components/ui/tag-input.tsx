"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { normalizeTags } from "@/lib/tags";
import { cn } from "@/lib/utils";

/** Chips plus a text box. Enter or a comma adds a tag; Backspace on an empty box removes the last one. */
export function TagInput({
  tags,
  onChange,
  id,
  label = "Tags",
  className,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  label?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(text: string) {
    const next = normalizeTags([...tags, ...text.split(",")]);
    if (next.length !== tags.length) onChange(next);
    setDraft("");
  }

  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 focus-within:border-ring",
        className,
      )}
    >
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
          #{tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((existing) => existing !== tag))}
            aria-label={`Remove tag ${tag}`}
            className="rounded-full hover:text-danger"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        aria-label={label}
        placeholder={tags.length === 0 ? "Add tags…" : ""}
        onChange={(event) => {
          if (event.target.value.includes(",")) commit(event.target.value);
          else setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
