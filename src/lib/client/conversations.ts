"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiRequest } from "@/lib/client/api";
import type { ConversationSummary } from "@/lib/chat/types";

/**
 * The list of chats, shared by the sidebar and the chat itself so a new or renamed chat shows up in both at once.
 * It lives outside React so it survives moving between pages.
 */
interface Snapshot {
  list: ConversationSummary[] | null;
  error: string | null;
}

let snapshot: Snapshot = { list: null, error: null };
const SERVER_SNAPSHOT: Snapshot = { list: null, error: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function refreshConversations(): Promise<void> {
  inflight ??= apiRequest<{ conversations: ConversationSummary[] }>("/api/conversations")
    .then((data) => publish({ list: data.conversations, error: null }))
    .catch((error: unknown) => publish({ list: snapshot.list, error: error instanceof Error ? error.message : "Couldn't load your chats." }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function addConversation(conversation: ConversationSummary): void {
  publish({ ...snapshot, list: [conversation, ...(snapshot.list ?? []).filter((item) => item.id !== conversation.id)] });
}

export function removeConversation(id: string): void {
  publish({ ...snapshot, list: (snapshot.list ?? []).filter((item) => item.id !== id) });
}

export function renameConversationLocally(id: string, title: string): void {
  publish({ ...snapshot, list: (snapshot.list ?? []).map((item) => (item.id === id ? { ...item, title } : item)) });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConversations(): Snapshot {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
  useEffect(() => {
    if (snapshot.list === null) void refreshConversations();
    const onFocus = () => void refreshConversations();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return current;
}

export interface ConversationGroup {
  label: string;
  items: ConversationSummary[];
}

/** Groups chats the way people look for them: today, yesterday, the last week, the last month, then by month. */
export function groupConversations(list: ConversationSummary[], now: Date = new Date()): ConversationGroup[] {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = startOfDay(now);
  const day = 86_400_000;
  const buckets: ConversationGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Previous 30 days", items: [] },
  ];
  const older = new Map<string, ConversationSummary[]>();
  for (const item of [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const when = new Date(item.updatedAt);
    const age = Math.floor((today - startOfDay(when)) / day);
    if (age <= 0) buckets[0].items.push(item);
    else if (age === 1) buckets[1].items.push(item);
    else if (age <= 7) buckets[2].items.push(item);
    else if (age <= 30) buckets[3].items.push(item);
    else {
      const label = when.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      older.set(label, [...(older.get(label) ?? []), item]);
    }
  }
  return [...buckets, ...[...older].map(([label, items]) => ({ label, items }))].filter((group) => group.items.length > 0);
}
