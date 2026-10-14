import Link from "next/link";
import { CheckCircle2, Circle, type LucideIcon } from "lucide-react";
import { DashboardGreeting } from "@/components/dashboard/greeting";
import { ShortcutKeys } from "@/components/shortcut-keys";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { navItems, type NavItem } from "@/lib/navigation";

const completed = [
  "Responsive app shell, routing for all 13 sections, and light, dark, and system themes",
  "Command palette and keyboard shortcuts",
  "OpenRouter API key settings, encrypted at rest, with a connection test",
  "Searchable model catalog with favorites, default model, and capability filters",
  "Streaming AI chat with saved conversations, stop, regenerate, and model switching",
  "Token usage, cost tracking, and a monthly spending limit",
  "Tasks with priorities, due dates, subtasks, tags, filters, and a Kanban board",
  "Markdown notes with folders, tags, search, and autosave",
  "Projects with milestones, progress dashboards, and linked tasks",
  "AI that proposes project plans, note summaries, priorities, and organization; nothing is saved until you confirm",
  "Agents that plan, use real tools on your tasks, notes, and projects, and pause for your approval before changing anything",
];

const notYet = [
  "Accounts and sign-in",
  "Calendar",
  "File attachments, branching, tool calling, and persistent memory",
  "Knowledge base, research, code workspace, automations, and analytics",
];

const moduleItems = navItems.filter((item) => item.id !== "home" && item.id !== "settings");

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <DashboardGreeting />

      <section aria-label="Quick actions" className="grid gap-3 sm:grid-cols-3">
        <QuickAction
          href="/settings"
          title="Appearance"
          description="Switch between light, dark, or system."
        />
        <QuickAction
          href="/settings#shortcuts"
          title="Keyboard shortcuts"
          description="See every shortcut available in the app."
        />
        <Card className="flex flex-col justify-between gap-3">
          <div className="space-y-1">
            <p className="font-semibold">Command palette</p>
            <p className="text-sm text-muted-foreground">Jump to any page or run an action from anywhere.</p>
          </div>
          <div>
            <ShortcutKeys keys={["mod", "K"]} />
          </div>
        </Card>
      </section>

      <section aria-labelledby="modules-heading" className="space-y-3">
        <h2 id="modules-heading" className="text-sm font-medium text-muted-foreground">
          Modules
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {moduleItems.map((item) => (
            <ModuleCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      <section aria-labelledby="status-heading" className="space-y-3">
        <h2 id="status-heading" className="text-sm font-medium text-muted-foreground">
          Build status
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <StatusCard title="Done in this build" items={completed} icon={CheckCircle2} tone="done" />
          <StatusCard title="Not built yet" items={notYet} icon={Circle} tone="todo" />
        </div>
      </section>
    </div>
  );
}

function QuickAction({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors group-hover:bg-accent/40">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </Card>
    </Link>
  );
}

function ModuleCard({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className="group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="flex h-full items-start gap-3 transition-colors group-hover:bg-accent/40">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{item.label}</p>
            <Badge tone={item.status === "ready" ? "success" : "neutral"}>
              {item.status === "ready" ? "Ready" : "Planned"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{item.description}</p>
        </div>
      </Card>
    </Link>
  );
}

function StatusCard({
  title,
  items,
  icon: Icon,
  tone,
}: {
  title: string;
  items: string[];
  icon: LucideIcon;
  tone: "done" | "todo";
}) {
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm">
            <Icon
              className={tone === "done" ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0 text-muted-foreground"}
              aria-hidden
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
