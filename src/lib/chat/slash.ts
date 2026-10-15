// Slash commands typed into the message box. They act inside the app (add a task, jump to a page) and are never sent to the model.

export interface SlashCommand {
  name: string;
  title: string;
  description: string;
  /** What to type after the command, shown as a hint. Present only for commands that need text. */
  argument?: string;
  /** Where the command goes, for commands that just open a page. */
  href?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "task", title: "Add a task", description: "Put something on your task list", argument: "what needs doing" },
  { name: "note", title: "Save a note", description: "Write a quick note", argument: "what to write down" },
  { name: "remember", title: "Remember this", description: "Save a fact for future chats", argument: "what to remember" },
  { name: "new", title: "New chat", description: "Start a fresh conversation" },
  { name: "today", title: "Today", description: "What's due and scheduled", href: "/today" },
  { name: "tasks", title: "Tasks", description: "Open your task list", href: "/tasks" },
  { name: "calendar", title: "Calendar", description: "Open your calendar", href: "/calendar" },
  { name: "notes", title: "Notes", description: "Open your notes", href: "/notes" },
  { name: "projects", title: "Projects", description: "Open your projects", href: "/projects" },
  { name: "research", title: "Research", description: "Get a cited report from the web", href: "/research" },
  { name: "knowledge", title: "Knowledge", description: "Your documents and memories", href: "/knowledge" },
  { name: "documents", title: "Documents", description: "Draft documents, slides and sheets", href: "/documents" },
  { name: "code", title: "Code", description: "The code workspace", href: "/code" },
  { name: "agents", title: "Agents", description: "Run or build an agent", href: "/agents" },
  { name: "automations", title: "Automations", description: "Schedules and triggers", href: "/automations" },
  { name: "integrations", title: "Integrations", description: "Connect GitHub, Notion, Google and more", href: "/integrations" },
  { name: "analytics", title: "Analytics", description: "Productivity and AI spend", href: "/analytics" },
  { name: "compare", title: "Compare models", description: "Ask several models at once", href: "/chat/compare" },
  { name: "settings", title: "Settings", description: "Keys, models and appearance", href: "/settings" },
];

/**
 * While the box holds just "/" and the start of a command name, the commands that fit it. Null once a space is typed
 * (the command is chosen and its text is being written) or when the text doesn't start with a slash.
 */
export function matchSlash(value: string): SlashCommand[] | null {
  const typed = /^\/([a-z]*)$/i.exec(value);
  if (!typed) return null;
  const needle = typed[1].toLowerCase();
  const matches = SLASH_COMMANDS.filter((command) => command.name.startsWith(needle));
  return matches.length > 0 ? matches : null;
}

/** A complete command with its text, or null when the message is an ordinary one. Unknown "/things" are ordinary messages. */
export function parseSlash(value: string): { command: SlashCommand; text: string } | null {
  const parsed = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(value.trim());
  if (!parsed) return null;
  const command = SLASH_COMMANDS.find((candidate) => candidate.name === parsed[1].toLowerCase());
  if (!command) return null;
  const text = (parsed[2] ?? "").trim();
  if (command.argument && !text) return null;
  return { command, text };
}
