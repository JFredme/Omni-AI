import {
  Bot,
  ChartColumn,
  Code,
  FolderKanban,
  Home,
  FileOutput,
  Library,
  Plug,
  Settings,
  Telescope,
  Workflow,
  CalendarDays,
  CheckSquare,
  MessageSquare,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

export type NavSectionName = "Workspace" | "Productivity" | "Knowledge" | "Automation";

export type NavStatus = "ready" | "planned";

export interface NavItem {
  id: string;
  href: string;
  /** Other paths that belong to this item, such as /chat/<id> for the chat home. */
  aliases?: string[];
  label: string;
  description: string;
  icon: LucideIcon;
  section: NavSectionName | "System";
  status: NavStatus;
}

export const navItems: NavItem[] = [
  {
    id: "chat",
    href: "/",
    aliases: ["/chat"],
    label: "Chat",
    description: "Talk to any model on OpenRouter. Everything else is a slash away.",
    icon: MessageSquare,
    section: "Workspace",
    status: "ready",
  },
  {
    id: "home",
    href: "/today",
    label: "Today",
    description: "Your day at a glance: what's due, what's scheduled, what you've written.",
    icon: Home,
    section: "Workspace",
    status: "ready",
  },
  {
    id: "agents",
    href: "/agents",
    label: "Agents",
    description: "Build and run multi-step agents with approvals.",
    icon: Bot,
    section: "Workspace",
    status: "ready",
  },
  {
    id: "tasks",
    href: "/tasks",
    label: "Tasks",
    description: "Priorities, deadlines, subtasks, and a Kanban board.",
    icon: CheckSquare,
    section: "Productivity",
    status: "ready",
  },
  {
    id: "calendar",
    href: "/calendar",
    label: "Calendar",
    description: "Month, week, and agenda views with repeating events and .ics import.",
    icon: CalendarDays,
    section: "Productivity",
    status: "ready",
  },
  {
    id: "notes",
    href: "/notes",
    label: "Notes",
    description: "Markdown notes with folders, tags, autosave, and AI summaries.",
    icon: NotebookPen,
    section: "Productivity",
    status: "ready",
  },
  {
    id: "projects",
    href: "/projects",
    label: "Projects",
    description: "Milestones, progress tracking, and AI-assisted planning.",
    icon: FolderKanban,
    section: "Productivity",
    status: "ready",
  },
  {
    id: "research",
    href: "/research",
    label: "Research",
    description: "Search, extract sources, and build cited reports.",
    icon: Telescope,
    section: "Knowledge",
    status: "ready",
  },
  {
    id: "knowledge",
    href: "/knowledge",
    label: "Knowledge",
    description: "Upload documents and memories, and ask questions with citations.",
    icon: Library,
    section: "Knowledge",
    status: "ready",
  },
  {
    id: "documents",
    href: "/documents",
    label: "Documents",
    description: "Draft documents, slides, and spreadsheets and download them as files.",
    icon: FileOutput,
    section: "Knowledge",
    status: "ready",
  },
  {
    id: "code",
    href: "/code",
    label: "Code",
    description: "Monaco editor, files, AI review with diffs, and sandboxed runs.",
    icon: Code,
    section: "Knowledge",
    status: "ready",
  },
  {
    id: "automations",
    href: "/automations",
    label: "Automations",
    description: "Step-by-step automations with schedules, triggers, and run history.",
    icon: Workflow,
    section: "Automation",
    status: "ready",
  },
  {
    id: "integrations",
    href: "/integrations",
    label: "Integrations",
    description: "Connect GitHub, Notion, Todoist, Slack, Discord, and Google.",
    icon: Plug,
    section: "Automation",
    status: "ready",
  },
  {
    id: "analytics",
    href: "/analytics",
    label: "Analytics",
    description: "Productivity trends, focus time, and AI usage costs.",
    icon: ChartColumn,
    section: "Automation",
    status: "ready",
  },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    description: "Appearance, keyboard shortcuts, and preferences.",
    icon: Settings,
    section: "System",
    status: "ready",
  },
];

export const navSections: { name: NavSectionName; items: NavItem[] }[] = [
  "Workspace",
  "Productivity",
  "Knowledge",
  "Automation",
].map((name) => ({
  name: name as NavSectionName,
  items: navItems.filter((item) => item.section === name),
}));

export function getNavItem(id: string): NavItem {
  const item = navItems.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown navigation item: ${id}`);
  }
  return item;
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Whether a path is the chat home or one of its conversations. Model comparison is its own page. */
export function isChatPath(pathname: string): boolean {
  if (pathname === "/chat/compare" || pathname.startsWith("/chat/compare/")) return false;
  return pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/");
}

export function findNavItemForPath(pathname: string): NavItem | undefined {
  if (isChatPath(pathname)) return navItems.find((item) => item.id === "chat");
  return navItems.find((item) => isActivePath(pathname, item.href) || item.aliases?.some((alias) => isActivePath(pathname, alias)));
}
