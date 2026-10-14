"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Monitor, Moon, PanelLeftClose, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { filterCommands } from "@/lib/command";
import { navItems } from "@/lib/navigation";
import { toggleSidebarCollapsed } from "@/lib/sidebar-store";
import { cn } from "@/lib/utils";

interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const commands: PaletteCommand[] = [
    ...navItems.map((item) => ({
      id: `nav-${item.id}`,
      label: item.label,
      group: "Go to",
      keywords: item.description,
      icon: item.icon,
      run: () => router.push(item.href),
    })),
    {
      id: "action-sidebar",
      label: "Toggle sidebar",
      group: "Actions",
      keywords: "collapse expand navigation",
      icon: PanelLeftClose,
      run: () => toggleSidebarCollapsed(),
    },
    {
      id: "action-theme-light",
      label: "Use light theme",
      group: "Appearance",
      keywords: "theme light bright",
      icon: Sun,
      run: () => setTheme("light"),
    },
    {
      id: "action-theme-dark",
      label: "Use dark theme",
      group: "Appearance",
      keywords: "theme dark night",
      icon: Moon,
      run: () => setTheme("dark"),
    },
    {
      id: "action-theme-system",
      label: "Use system theme",
      group: "Appearance",
      keywords: "theme system auto os",
      icon: Monitor,
      run: () => setTheme("system"),
    },
  ];

  const results = filterCommands(commands, query);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  function runCommand(command: PaletteCommand) {
    onClose();
    command.run();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length ? (index - 1 + results.length) % results.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = results[activeIndex];
      if (command) {
        runCommand(command);
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl animate-pop-in"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[activeIndex] ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            placeholder="Search pages and actions…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matches for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            results.map((command, index) => {
              const Icon = command.icon;
              const showGroup = index === 0 || results[index - 1].group !== command.group;
              const active = index === activeIndex;
              return (
                <div key={command.id}>
                  {showGroup ? (
                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {command.group}
                    </p>
                  ) : null}
                  <button
                    id={optionId(index)}
                    ref={active ? activeRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{command.label}</span>
                    {active ? (
                      <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
