import {
  Bot,
  ChartColumn,
  Code,
  FolderKanban,
  Home,
  Library,
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
  label: string;
  description: string;
  icon: LucideIcon;
  section: NavSectionName | "System";
  status: NavStatus;
}

export const navItems: NavItem[] = [
  {
    id: "home",
    href: "/",
    label: "Home",
    description: "Your day at a glance.",
    icon: Home,
    section: "Workspace",
    status: "ready",
  },
  {
    id: "chat",
    href: "/chat",
    label: "AI Chat",
    description: "Converse with models through OpenRouter.",
    icon: MessageSquare,
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
    status: "planned",
  },
  {
    id: "tasks",
    href: "/tasks",
    label: "Tasks",
    description: "Priorities, deadlines, subtasks, and a Kanban board.",
    icon: CheckSquare,
    section: "Productivity",
    status: "planned",
  },
  {
    id: "calendar",
    href: "/calendar",
    label: "Calendar",
    description: "Day, week, and month views with time blocking.",
    icon: CalendarDays,
    section: "Productivity",
    status: "planned",
  },
  {
    id: "notes",
    href: "/notes",
    label: "Notes",
    description: "Markdown notes with folders, tags, and backlinks.",
    icon: NotebookPen,
    section: "Productivity",
    status: "planned",
  },
  {
    id: "projects",
    href: "/projects",
    label: "Projects",
    description: "Milestones, dependencies, and progress tracking.",
    icon: FolderKanban,
    section: "Productivity",
    status: "planned",
  },
  {
    id: "research",
    href: "/research",
    label: "Research",
    description: "Search, extract sources, and build cited reports.",
    icon: Telescope,
    section: "Knowledge",
    status: "planned",
  },
  {
    id: "knowledge",
    href: "/knowledge",
    label: "Knowledge",
    description: "Upload documents and ask questions with citations.",
    icon: Library,
    section: "Knowledge",
    status: "planned",
  },
  {
    id: "code",
    href: "/code",
    label: "Code",
    description: "Editor, file explorer, diffs, and a sandboxed terminal.",
    icon: Code,
    section: "Knowledge",
    status: "planned",
  },
  {
    id: "automations",
    href: "/automations",
    label: "Automations",
    description: "Visual workflows with triggers, actions, and logs.",
    icon: Workflow,
    section: "Automation",
    status: "planned",
  },
  {
    id: "analytics",
    href: "/analytics",
    label: "Analytics",
    description: "Productivity trends, focus time, and AI usage costs.",
    icon: ChartColumn,
    section: "Automation",
    status: "planned",
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

export function findNavItemForPath(pathname: string): NavItem | undefined {
  return navItems.find((item) => isActivePath(pathname, item.href));
}
