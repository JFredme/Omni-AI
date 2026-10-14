import type { Metadata } from "next";
import { AppearanceCard } from "@/components/settings/appearance-card";
import { OpenRouterSettings } from "@/components/settings/openrouter-settings";
import { ShortcutsCard } from "@/components/settings/shortcuts-card";
import { SidebarCard } from "@/components/settings/sidebar-card";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { getNavItem } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  const item = getNavItem("settings");
  const Icon = item.icon;

  return (
    <div className="space-y-6">
      <PageHeader icon={Icon} title="Settings" description={item.description} />

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenRouterSettings />
        <AppearanceCard />
        <SidebarCard />
        <ShortcutsCard />
        <Card className="space-y-2 lg:col-span-2">
          <h2 className="font-semibold">About this build</h2>
          <p className="text-sm text-muted-foreground">
            OMNI AI 0.1.0 · Part 2: OpenRouter AI chat. Built with Next.js 16, React 19, Tailwind CSS v4, Prisma, and
            PostgreSQL.
          </p>
          <p className="text-sm text-muted-foreground">
            Conversations, messages, usage records, and these settings are stored in PostgreSQL. Accounts, agents, and
            the other modules are not built yet.
          </p>
        </Card>
      </div>
    </div>
  );
}
