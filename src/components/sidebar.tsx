"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLoginRequired } from "@/lib/client/login-required";
import { localDateKey } from "@/lib/dates";
import { navItems, navSections, isActivePath, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** What needs attention on the task list: overdue first, otherwise what's due today. Refreshed when you return to the tab. */
function useTaskBadge(): { count: number; overdue: boolean } | null {
  const pathname = usePathname();
  const [badge, setBadge] = useState<{ count: number; overdue: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      fetch(`/api/dashboard?today=${localDateKey()}&tz=${encodeURIComponent(zone)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { dashboard?: { counts: { overdue: number; dueToday: number } } } | null) => {
          if (cancelled || !data?.dashboard) return;
          const { overdue, dueToday } = data.dashboard.counts;
          setBadge(overdue > 0 ? { count: overdue, overdue: true } : dueToday > 0 ? { count: dueToday, overdue: false } : null);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [pathname]);
  return badge;
}

function NavLink({
  item,
  collapsed,
  onNavigate,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  badge?: { count: number; overdue: boolean } | null;
}) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors",
        active
          ? "bg-accent font-medium text-foreground before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-r before:bg-primary"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-[17px] shrink-0" strokeWidth={1.6} aria-hidden />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <>
          <span className="truncate">{item.label}</span>
          {item.status === "planned" ? (
            <span className="eyebrow ml-auto !text-[10px]">Soon</span>
          ) : null}
          {badge ? (
            <span
              className={cn("num ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5", badge.overdue ? "bg-destructive/12 text-destructive" : "bg-primary/10 text-primary")}
              title={badge.overdue ? `${badge.count} overdue` : `${badge.count} due today`}
            >
              {badge.count}
            </span>
          ) : null}
        </>
      )}
    </Link>
  );
}

async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    // A full page load, so nothing from the signed-in session stays in the client cache.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-primary" aria-hidden>
      <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="3.6" fill="currentColor" />
    </svg>
  );
}

export function NavContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const settings = navItems.find((item) => item.id === "settings");
  const loginRequired = useLoginRequired();
  const taskBadge = useTaskBadge();

  return (
    <>
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 px-4 pt-1",
          collapsed && "justify-center px-0",
        )}
      >
        <Mark />
        {collapsed ? null : <span className="font-display text-xl font-medium">Omni</span>}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-2">
        {navSections.map((section) => (
          <div key={section.name} className="mb-4">
            {collapsed ? null : (
              <p className="eyebrow px-2.5 pb-1.5">
                {section.name}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.id}>
                  <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} badge={item.id === "tasks" ? taskBadge : null} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {settings ? (
        <div className="space-y-0.5 border-t border-sidebar-border px-2 py-2">
          <NavLink item={settings} collapsed={collapsed} onNavigate={onNavigate} />
          {loginRequired ? (
          <button
            type="button"
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <LogOut className="size-[17px] shrink-0" strokeWidth={1.6} aria-hidden />
            {collapsed ? <span className="sr-only">Sign out</span> : <span>Sign out</span>}
          </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function DesktopSidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <aside
      aria-label="Sidebar"
      data-collapsed={collapsed}
      className={cn(
        "hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <NavContent collapsed={collapsed} />
      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar (⌘B / Ctrl+B)" : "Collapse sidebar (⌘B / Ctrl+B)"}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
          {collapsed ? <span className="sr-only">Expand sidebar</span> : <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

export function MobileSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 animate-fade-in"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar animate-slide-in-left"
      >
        <NavContent collapsed={false} onNavigate={onClose} />
      </aside>
    </div>
  );
}
