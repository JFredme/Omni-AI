"use client";

import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { ThemeCycleButton } from "@/components/theme-toggle";
import { useModifierLabel } from "@/lib/client-hooks";
import { findNavItemForPath } from "@/lib/navigation";

export function Topbar({
  onOpenMenu,
  onOpenPalette,
}: {
  onOpenMenu: () => void;
  onOpenPalette: () => void;
}) {
  const pathname = usePathname();
  const modifier = useModifierLabel();
  const current = findNavItemForPath(pathname);
  const CurrentIcon = current?.icon;

  return (
    <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        {CurrentIcon ? <CurrentIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className="truncate text-sm font-medium">{current?.label ?? "OMNI AI"}</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:w-64 sm:justify-between"
        >
          <span className="inline-flex items-center gap-2">
            <Search className="size-4" aria-hidden />
            <span className="hidden sm:inline">Search or run a command</span>
          </span>
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] sm:inline">
            {modifier}K
          </kbd>
        </button>
        <ThemeCycleButton />
      </div>
    </header>
  );
}
