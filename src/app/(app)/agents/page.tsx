import type { Metadata } from "next";
import { AgentsWorkspace } from "@/components/agents/agents-workspace";

export const metadata: Metadata = {
  title: "Agents",
};

export default function Page() {
  return <AgentsWorkspace />;
}
