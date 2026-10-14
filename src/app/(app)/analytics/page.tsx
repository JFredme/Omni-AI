import type { Metadata } from "next";
import { AnalyticsWorkspace } from "@/components/analytics/analytics-workspace";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return <AnalyticsWorkspace />;
}
