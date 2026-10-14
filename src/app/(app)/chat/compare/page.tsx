import type { Metadata } from "next";
import { CompareWorkspace } from "@/components/chat/compare-workspace";

export const metadata: Metadata = { title: "Compare models" };

export default function Page() {
  return <CompareWorkspace />;
}
