import type { Metadata } from "next";
import { CodeWorkspace } from "@/components/code/code-workspace";

export const metadata: Metadata = { title: "Code" };

export default function Page() {
  return <CodeWorkspace />;
}
