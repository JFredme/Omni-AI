"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ShortcutKeys } from "@/components/shortcut-keys";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { toggleSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar-store";

export function SidebarCard() {
  const collapsed = useSidebarCollapsed();
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h2 className="font-semibold">Sidebar</h2>
        <p className="text-sm text-muted-foreground">
          Collapsed sidebars show icons only on desktop. Remembered in this browser.{" "}
          <span className="inline-flex items-center gap-1 align-middle">
            <ShortcutKeys keys={["mod", "B"]} />
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => toggleSidebarCollapsed()}
        className={buttonVariants({ variant: "outline", className: "shrink-0" })}
      >
        <Icon className="size-4" aria-hidden />
        {collapsed ? "Expand sidebar" : "Collapse sidebar"}
      </button>
    </Card>
  );
}
