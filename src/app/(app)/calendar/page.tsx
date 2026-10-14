import type { Metadata } from "next";
import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";

export const metadata: Metadata = { title: "Calendar" };

export default function Page() {
  return <CalendarWorkspace />;
}
