import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata: Metadata = { title: "Omni" };

export default function HomePage() {
  return <ChatWorkspace initialId={null} />;
}
