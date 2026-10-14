import type { Metadata } from "next";
import { AutomationsWorkspace } from "@/components/automations/automations-workspace";

export const metadata: Metadata = { title: "Automations" };

export default function Page() {
  return <AutomationsWorkspace />;
}
