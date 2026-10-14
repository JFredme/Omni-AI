"use client";

import { useModifierLabel } from "@/lib/client-hooks";

export function ShortcutKeys({ keys }: { keys: string[] }) {
  const modifier = useModifierLabel();

  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="min-w-6 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] text-muted-foreground"
        >
          {key === "mod" ? modifier : key}
        </kbd>
      ))}
    </span>
  );
}
