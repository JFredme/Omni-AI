import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata: Metadata = {
  title: "AI Chat",
};

export default function ChatPage() {
  return <ChatWorkspace initialId={null} />;
}
