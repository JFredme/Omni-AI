"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { announce, NEW_CHAT_EVENT } from "@/lib/client/app-events";
import { apiRequest } from "@/lib/client/api";
import { groupConversations, removeConversation, renameConversationLocally, useConversations } from "@/lib/client/conversations";
import { useLoginRequired } from "@/lib/client/login-required";
import { useModifierLabel } from "@/lib/client-hooks";
import { localDateKey } from "@/lib/dates";
import { isChatPath, navItems, type NavItem } from "@/lib/navigation";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";

const WORKSPACE_KEY = "omni-sidebar-workspace";

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

async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    // A full page load, so nothing from the signed-in session stays in the client cache.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 shrink-0 text-primary", className)} aria-hidden>
      <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="3.6" fill="currentColor" />
    </svg>
  );
}

function useNewChat() {
  const pathname = usePathname();
  const router = useRouter();
  return () => {
    if (isChatPath(pathname)) announce(NEW_CHAT_EVENT);
    else router.push("/");
  };
}

type Badge = { count: number; overdue: boolean } | null | undefined;

function WorkspaceLink({ item, collapsed, onNavigate, badge }: { item: NavItem; collapsed: boolean; onNavigate?: () => void; badge?: Badge }) {
  const pathname = usePathname();
  const active = item.id === "chat" ? isChatPath(pathname) : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : item.description}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg text-[13px] transition-colors",
        collapsed ? "justify-center px-0 py-2" : "px-2.5 py-1.5",
        active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-[16px] shrink-0" strokeWidth={1.6} aria-hidden />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {badge && !collapsed ? (
        <span
          className={cn("num ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5", badge.overdue ? "bg-destructive/12 text-destructive" : "bg-primary/10 text-primary")}
          title={badge.overdue ? `${badge.count} overdue` : `${badge.count} due today`}
        >
          {badge.count}
        </span>
      ) : null}
      {badge && collapsed ? <span aria-hidden className={cn("absolute right-3 top-1.5 size-1.5 rounded-full", badge.overdue ? "bg-destructive" : "bg-primary")} /> : null}
    </Link>
  );
}

function ChatRow({ id, title, active, onNavigate }: { id: string; title: string; active: boolean; onNavigate?: () => void }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveTitle() {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === title) return;
    renameConversationLocally(id, next);
    try {
      await apiRequest(`/api/conversations/${id}`, { method: "PATCH", json: { title: next } });
    } catch {
      renameConversationLocally(id, title);
      setError("Couldn't rename that chat.");
    }
  }

  async function remove() {
    setConfirming(false);
    try {
      await apiRequest(`/api/conversations/${id}`, { method: "DELETE" });
      removeConversation(id);
      if (active) router.push("/");
    } catch {
      setError("Couldn't delete that chat.");
    }
  }

  if (renaming) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void saveTitle()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void saveTitle();
          if (event.key === "Escape") setRenaming(false);
        }}
        maxLength={120}
        aria-label={`New name for ${title}`}
        className="h-9 w-full rounded-lg border border-ring bg-card px-3 text-[13.5px] outline-none"
      />
    );
  }

  return (
    <div className="group relative">
      <Link
        href={`/chat/${id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={title}
        className={cn(
          "block truncate rounded-lg px-3 py-2 pr-16 text-[13.5px] leading-5 transition-colors",
          active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {title}
      </Link>
      {confirming ? (
        <div className="absolute inset-y-0 right-1 flex items-center gap-1 rounded-lg bg-sidebar pl-2">
          <button type="button" onClick={() => void remove()} className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white">
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} aria-label="Cancel" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => {
              setDraft(title);
              setRenaming(true);
            }}
            aria-label={`Rename ${title}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => setConfirming(true)} aria-label={`Delete ${title}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-danger">
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="px-3 pb-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ChatHistory({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { list, error } = useConversations();
  const [query, setQuery] = useState("");
  const activeId = /^\/chat\/([^/]+)$/.exec(pathname)?.[1] ?? null;
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groupConversations((list ?? []).filter((item) => !needle || item.title.toLowerCase().includes(needle)));
  }, [list, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {list && list.length > 6 ? (
        <div className="px-3 pb-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-8 w-full rounded-lg border border-transparent bg-accent/50 px-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-card"
          />
        </div>
      ) : null}
      <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {list === null ? (
          <div className="space-y-1.5 px-1 pt-1" role="status" aria-label="Loading chats">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="skeleton h-8 rounded-lg" style={{ animationDelay: `${index * 120}ms`, opacity: 1 - index * 0.18 }} />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{list.length > 0 ? "No chats match." : error ? "Couldn't load your chats." : "No conversations yet."}</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="mb-3">
              <h2 className="eyebrow px-3 pb-1 pt-1.5">{group.label}</h2>
              <ul className="space-y-px">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <ChatRow id={item.id} title={item.title} active={item.id === activeId} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>
    </div>
  );
}

export function NavContent({
  collapsed,
  onNavigate,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
}) {
  const pathname = usePathname();
  const startNewChat = useNewChat();
  const modifier = useModifierLabel();
  const loginRequired = useLoginRequired();
  const taskBadge = useTaskBadge();
  const onChat = isChatPath(pathname);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const restored = useRef(false);

  // On a feature page the Workspace group starts open; on the chat it starts closed. Your choice is remembered.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(WORKSPACE_KEY);
    } catch {
      // Storage can be blocked; the default stands.
    }
    // In the phone drawer the links are the only way to other pages, so they start open there too.
    setWorkspaceOpen(remembered ? remembered === "open" : !onChat || Boolean(onNavigate));
  }, [onChat, onNavigate]);

  function toggleWorkspace() {
    setWorkspaceOpen((open) => {
      try {
        window.localStorage.setItem(WORKSPACE_KEY, open ? "closed" : "open");
      } catch {
        // Not remembered, still applied.
      }
      return !open;
    });
  }

  const settings = navItems.find((item) => item.id === "settings");
  const modules = navItems.filter((item) => item.id !== "settings");
  const newChatClass = "inline-flex items-center gap-2 rounded-xl border border-border bg-card text-sm font-medium transition-[background-color,border-color,transform] hover:border-primary/40 hover:bg-accent/50 active:translate-y-px";

  return (
    <>
      <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <Mark />
        {collapsed ? null : <span className="font-display text-xl font-medium">Omni</span>}
        {onToggleCollapsed && !collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded
            aria-label="Collapse sidebar"
            title={`Collapse sidebar (${modifier}B)`}
            className="ml-auto grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <PanelLeftClose className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className={cn("px-3 pb-3", collapsed && "grid place-items-center px-2")}>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            startNewChat();
          }}
          title={collapsed ? "New chat" : undefined}
          className={cn(newChatClass, collapsed ? "size-10 justify-center" : "h-10 w-full px-3")}
        >
          <Plus className="size-4 text-primary" aria-hidden />
          {collapsed ? <span className="sr-only">New chat</span> : <span>New chat</span>}
          {collapsed ? null : <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{modifier}⇧O</kbd>}
        </button>
      </div>

      {collapsed ? (
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {modules.map((item) => (
            <WorkspaceLink key={item.id} item={item} collapsed onNavigate={onNavigate} badge={item.id === "tasks" ? taskBadge : null} />
          ))}
        </nav>
      ) : (
        <ChatHistory onNavigate={onNavigate} />
      )}

      {collapsed ? null : (
        <div className="border-t border-sidebar-border px-2 pt-1">
          <button
            type="button"
            onClick={toggleWorkspace}
            aria-expanded={workspaceOpen}
            aria-controls="workspace-links"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="eyebrow !text-[10.5px]">Workspace</span>
            <ChevronDown className={cn("ml-auto size-3.5 transition-transform duration-200", workspaceOpen && "rotate-180")} aria-hidden />
          </button>
          <nav id="workspace-links" aria-label="Main" hidden={!workspaceOpen} className="grid grid-cols-2 gap-0.5 pb-2">
            {modules.map((item) => (
              <WorkspaceLink key={item.id} item={item} collapsed={false} onNavigate={onNavigate} badge={item.id === "tasks" ? taskBadge : null} />
            ))}
          </nav>
        </div>
      )}

      <div className="border-t border-sidebar-border p-2">
        <div className={cn("flex items-center", collapsed ? "flex-col gap-0.5" : "gap-1")}>
          {settings ? (
            <div className={collapsed ? "w-full" : "flex-1"}>
              <WorkspaceLink item={settings} collapsed={collapsed} onNavigate={onNavigate} />
            </div>
          ) : null}
          {loginRequired ? (
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <LogOut className="size-4" strokeWidth={1.6} aria-hidden />
              <span className="sr-only">Sign out</span>
            </button>
          ) : null}
          {collapsed && onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={false}
              aria-label="Expand sidebar"
              title={`Expand sidebar (${modifier}B)`}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <PanelLeftOpen className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {collapsed ? null : <p className="num px-3 pb-1 pt-0.5 text-[11px] text-muted-foreground/70">Omni {APP_VERSION}</p>}
      </div>
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
        collapsed ? "w-[68px]" : "w-72",
      )}
    >
      <NavContent collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
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
        className="absolute inset-y-0 left-0 flex w-80 max-w-[88vw] flex-col border-r border-sidebar-border bg-sidebar animate-slide-in-left"
      >
        <NavContent collapsed={false} onNavigate={onClose} />
      </aside>
    </div>
  );
}
