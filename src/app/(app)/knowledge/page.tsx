import type { Metadata } from "next";
import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";

export const metadata: Metadata = { title: "Knowledge" };

export default function Page() {
  return <KnowledgeWorkspace />;
}
