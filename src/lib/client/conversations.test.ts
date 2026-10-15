import { describe, expect, it } from "vitest";
import type { ConversationSummary } from "@/lib/chat/types";
import { groupConversations } from "./conversations";

const chat = (id: string, updatedAt: string): ConversationSummary => ({ id, title: id, modelId: null, messageCount: 1, createdAt: updatedAt, updatedAt });
const NOW = new Date(2026, 9, 14, 15, 0, 0); // Oct 14, 2026, 3pm local

describe("groupConversations", () => {
  it("groups chats by how recently they were used, newest first", () => {
    const groups = groupConversations(
      [
        chat("old", new Date(2026, 7, 2, 9).toISOString()),
        chat("today-early", new Date(2026, 9, 14, 8).toISOString()),
        chat("today-late", new Date(2026, 9, 14, 14).toISOString()),
        chat("yesterday", new Date(2026, 9, 13, 23).toISOString()),
        chat("this-week", new Date(2026, 9, 9, 12).toISOString()),
        chat("this-month", new Date(2026, 8, 25, 12).toISOString()),
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "August 2026"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["today-late", "today-early"]);
  });

  it("leaves out empty groups and handles no chats", () => {
    expect(groupConversations([], NOW)).toEqual([]);
    expect(groupConversations([chat("a", new Date(2026, 9, 14, 1).toISOString())], NOW).map((group) => group.label)).toEqual(["Today"]);
  });
});
