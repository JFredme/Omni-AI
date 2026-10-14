import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata: Metadata = {
  title: "AI Chat",
};

async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatWorkspace initialId={id} />;
}

// `params` is read inside the Suspense boundary so the page shell doesn't depend on the URL.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div aria-hidden className="h-64 animate-pulse rounded-2xl bg-muted" />}>
      <ConversationPage params={params} />
    </Suspense>
  );
}
