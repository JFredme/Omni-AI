import type { Metadata } from "next";
import { HomeDashboard } from "@/components/dashboard/home";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return <HomeDashboard />;
}
