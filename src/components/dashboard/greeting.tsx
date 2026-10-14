"use client";

import { getGreeting } from "@/lib/greeting";

export function DashboardGreeting() {
  const now = new Date();
  const greeting = getGreeting(now);
  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground" suppressHydrationWarning>
        {date}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight" suppressHydrationWarning>
        {greeting}
      </h1>
    </div>
  );
}
