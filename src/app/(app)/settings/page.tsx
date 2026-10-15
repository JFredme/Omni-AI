import type { Metadata } from "next";
import { ComputerCard } from "@/components/settings/computer-card";
import { AppearanceCard } from "@/components/settings/appearance-card";
import { OpenRouterSettings } from "@/components/settings/openrouter-settings";
import { ShortcutsCard } from "@/components/settings/shortcuts-card";
import { SearchSettingsCard } from "@/components/research/search-settings-card";
import { SecurityCard } from "@/components/settings/security-card";
import { SidebarCard } from "@/components/settings/sidebar-card";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { getNavItem } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  const item = getNavItem("settings");

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={item.description} />

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenRouterSettings />
        <AppearanceCard />
        <SidebarCard />
        <ShortcutsCard />
        <SearchSettingsCard />
        <ComputerCard />
        <SecurityCard />
        <Card className="space-y-2 lg:col-span-2">
          <h2 className="font-semibold">About this install</h2>
          <p className="text-sm text-muted-foreground">
            OMNI AI is self-hosted: your tasks, notes, projects, conversations, agents, and settings live in your own
            PostgreSQL database. The only outside service it calls is OpenRouter, using the key you saved above.
          </p>
        </Card>
      </div>
    </div>
  );
}
