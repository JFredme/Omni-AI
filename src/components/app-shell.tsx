"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette } from "@/components/command-palette";
import { DesktopSidebar, MobileSidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { toggleSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar-store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const collapsed = useSidebarCollapsed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (!modifier || event.altKey || event.shiftKey) {
        return;
      }
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === "b") {
        event.preventDefault();
        toggleSidebarCollapsed();
      } else if (key === ",") {
        event.preventDefault();
        router.push("/settings");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <Suspense fallback={<div aria-hidden className="hidden h-dvh w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block" />}>
        <DesktopSidebar collapsed={collapsed} onToggleCollapsed={toggleSidebarCollapsed} />
      </Suspense>
      <Suspense fallback={null}>
        <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      </Suspense>

      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div aria-hidden className="h-14 shrink-0 border-b border-border" />}>
          <Topbar onOpenMenu={() => setMenuOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        </Suspense>
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>

      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}
