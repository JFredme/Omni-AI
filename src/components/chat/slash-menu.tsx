"use client";

import { useEffect, useRef } from "react";
import { CornerDownLeft } from "lucide-react";
import type { SlashCommand } from "@/lib/chat/slash";
import { cn } from "@/lib/utils";

/** The list of commands that opens above the message box when you type "/". */
export function SlashMenu({
  commands,
  activeIndex,
  onHover,
  onPick,
  id,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (command: SlashCommand) => void;
  id: string;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="animate-pop-in absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-border bg-popover">
      <ul id={id} role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto p-1.5">
        {commands.map((command, index) => {
          const active = index === activeIndex;
          return (
            <li key={command.name} role="presentation">
              <button
                ref={active ? activeRef : undefined}
                type="button"
                role="option"
                id={`${id}-${command.name}`}
                aria-selected={active}
                tabIndex={-1}
                // mousedown, so the text box doesn't lose focus before the click lands
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => onHover(index)}
                onClick={() => onPick(command)}
                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors", active ? "bg-accent" : "")}
              >
                <span className="num w-24 shrink-0 font-mono text-[13px] text-primary">/{command.name}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{command.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{command.argument ? `${command.description}` : command.description}</span>
                </span>
                {active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
