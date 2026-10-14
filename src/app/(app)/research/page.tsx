import type { Metadata } from "next";
import { ResearchWorkspace } from "@/components/research/research-workspace";

export const metadata: Metadata = { title: "Research" };

export default function Page() {
  return <ResearchWorkspace />;
}
