// Client-safe description of the services Omni can connect to and what it can do with each.

export const PROVIDERS = ["github", "notion", "todoist", "slack", "discord", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ProviderInfo {
  id: Provider;
  label: string;
  summary: string;
  /** How you connect: paste a token, paste a webhook address, or sign in through the service. */
  auth: "token" | "webhook" | "oauth";
  secretLabel?: string;
  secretHint?: string;
  helpUrl: string;
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  github: {
    id: "github",
    label: "GitHub",
    summary: "Read your repositories and issues, and open issues or comment on them.",
    auth: "token",
    secretLabel: "Personal access token",
    secretHint: "Create a fine-grained token at github.com/settings/tokens with access to the repositories you want. Issues: read and write is enough.",
    helpUrl: "https://github.com/settings/tokens",
  },
  notion: {
    id: "notion",
    label: "Notion",
    summary: "Search your Notion pages and create new pages.",
    auth: "token",
    secretLabel: "Internal integration secret",
    secretHint: "Create an internal integration at notion.so/profile/integrations, copy its secret, then share the pages you want with it from Notion's Connections menu.",
    helpUrl: "https://www.notion.so/profile/integrations",
  },
  todoist: {
    id: "todoist",
    label: "Todoist",
    summary: "See your Todoist tasks, add tasks, and complete them.",
    auth: "token",
    secretLabel: "API token",
    secretHint: "Find your token in Todoist under Settings, Integrations, Developer.",
    helpUrl: "https://app.todoist.com/app/settings/integrations/developer",
  },
  slack: {
    id: "slack",
    label: "Slack",
    summary: "Post messages to a channel through an incoming webhook.",
    auth: "webhook",
    secretLabel: "Incoming webhook address",
    secretHint: "Create an incoming webhook for your workspace at api.slack.com/apps and paste its address (it starts with https://hooks.slack.com/).",
    helpUrl: "https://api.slack.com/messaging/webhooks",
  },
  discord: {
    id: "discord",
    label: "Discord",
    summary: "Post messages to a channel through a webhook.",
    auth: "webhook",
    secretLabel: "Webhook address",
    secretHint: "In Discord, open Channel Settings, Integrations, Webhooks, create one, and paste its address (it starts with https://discord.com/api/webhooks/).",
    helpUrl: "https://support.discord.com/hc/en-us/articles/228383668",
  },
  google: {
    id: "google",
    label: "Google (Gmail, Calendar, Drive)",
    summary: "Read recent email and make drafts, import calendar events, and find or import Drive files.",
    auth: "oauth",
    helpUrl: "https://console.cloud.google.com/apis/credentials",
  },
};

export type ActionRisk = "read" | "write";
export interface ActionField {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface ActionInfo {
  id: string;
  provider: Provider;
  label: string;
  description: string;
  /** "write" actions change something outside Omni; they always ask first. */
  risk: ActionRisk;
  fields: ActionField[];
}

const repo = { name: "repo", label: "Repository", kind: "text", required: true, placeholder: "owner/name" } as const;

export const ACTIONS: ActionInfo[] = [
  { id: "github.list_repos", provider: "github", label: "List my repositories", description: "Your most recently updated repositories.", risk: "read", fields: [] },
  { id: "github.list_issues", provider: "github", label: "List issues", description: "Open or closed issues in a repository (pull requests are left out).", risk: "read", fields: [repo, { name: "state", label: "State", kind: "select", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }] }] },
  { id: "github.create_issue", provider: "github", label: "Open an issue", description: "Creates a new issue in the repository, visible to everyone who can see it.", risk: "write", fields: [repo, { name: "title", label: "Title", kind: "text", required: true }, { name: "body", label: "Description", kind: "textarea" }] },
  { id: "github.comment", provider: "github", label: "Comment on an issue", description: "Adds a comment to an issue or pull request, visible to everyone who can see it.", risk: "write", fields: [repo, { name: "number", label: "Issue number", kind: "number", required: true }, { name: "body", label: "Comment", kind: "textarea", required: true }] },

  { id: "notion.search", provider: "notion", label: "Search pages", description: "Pages shared with the integration that match your words.", risk: "read", fields: [{ name: "query", label: "Search for", kind: "text", required: true }] },
  { id: "notion.create_page", provider: "notion", label: "Create a page", description: "Adds a page inside an existing page you've shared with the integration.", risk: "write", fields: [{ name: "parentPageId", label: "Parent page ID", kind: "text", required: true, hint: "The long ID at the end of a Notion page's address." }, { name: "title", label: "Title", kind: "text", required: true }, { name: "content", label: "Text", kind: "textarea" }] },

  { id: "todoist.list_tasks", provider: "todoist", label: "List tasks", description: "Your Todoist tasks, optionally filtered (for example: today, overdue, p1).", risk: "read", fields: [{ name: "filter", label: "Filter", kind: "text", placeholder: "today" }] },
  { id: "todoist.create_task", provider: "todoist", label: "Add a task", description: "Creates a task in your Todoist inbox.", risk: "write", fields: [{ name: "content", label: "Task", kind: "text", required: true }, { name: "dueString", label: "Due", kind: "text", placeholder: "tomorrow at 9am" }] },
  { id: "todoist.complete_task", provider: "todoist", label: "Complete a task", description: "Marks a Todoist task as done.", risk: "write", fields: [{ name: "id", label: "Task ID", kind: "text", required: true }] },

  { id: "slack.post_message", provider: "slack", label: "Post a message", description: "Sends a message to the channel your webhook is tied to, visible to everyone there.", risk: "write", fields: [{ name: "text", label: "Message", kind: "textarea", required: true }] },
  { id: "discord.post_message", provider: "discord", label: "Post a message", description: "Sends a message to the channel your webhook is tied to, visible to everyone there.", risk: "write", fields: [{ name: "content", label: "Message", kind: "textarea", required: true }] },

  { id: "gmail.list_messages", provider: "google", label: "List recent email", description: "Sender, subject, date, and a short preview of recent messages. Message bodies aren't read.", risk: "read", fields: [{ name: "query", label: "Gmail search", kind: "text", placeholder: "is:unread newer_than:2d" }, { name: "limit", label: "How many", kind: "number", placeholder: "10" }] },
  { id: "gmail.create_draft", provider: "google", label: "Create an email draft", description: "Saves a draft in Gmail. It is not sent: you send it yourself from Gmail.", risk: "write", fields: [{ name: "to", label: "To", kind: "text", required: true }, { name: "subject", label: "Subject", kind: "text", required: true }, { name: "body", label: "Message", kind: "textarea", required: true }] },
  { id: "gcal.list_events", provider: "google", label: "List calendar events", description: "Events from your primary Google calendar.", risk: "read", fields: [{ name: "days", label: "Days ahead", kind: "number", placeholder: "7" }] },
  { id: "gcal.import_events", provider: "google", label: "Import events into Omni", description: "Copies upcoming events from Google Calendar into Omni's calendar. Running it again updates them instead of duplicating.", risk: "write", fields: [{ name: "days", label: "Days ahead", kind: "number", placeholder: "30" }] },
  { id: "drive.search", provider: "google", label: "Search Drive", description: "File names, types, and links for files that match.", risk: "read", fields: [{ name: "query", label: "File name contains", kind: "text", required: true }] },
  { id: "drive.import_to_knowledge", provider: "google", label: "Add a Drive file to Knowledge", description: "Reads a Google Doc or a text file and adds its text to your Knowledge base.", risk: "write", fields: [{ name: "fileId", label: "File ID", kind: "text", required: true, hint: "From a Drive search result." }] },
];

export const actionById = (id: string) => ACTIONS.find((action) => action.id === id);
export const actionsFor = (provider: Provider) => ACTIONS.filter((action) => action.provider === provider);

export interface ConnectionDto {
  provider: Provider;
  connected: boolean;
  account: string | null;
  scopes: string[];
  lastUsedAt: string | null;
  lastError: string | null;
  /** For OAuth providers: whether this server has the credentials it needs to start sign-in. */
  configured: boolean;
}

export const GOOGLE_SCOPE_SETS = {
  read: { label: "Read only", scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/drive.readonly"] },
  drafts: { label: "Read, plus email drafts", scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/drive.readonly"] },
} as const;
export type GoogleScopeSet = keyof typeof GOOGLE_SCOPE_SETS;
