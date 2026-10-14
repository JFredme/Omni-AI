import { callService, IntegrationError, trimText } from "../http";

// GitHub, Notion, Todoist, Slack, and Discord: connections made with a token or a webhook address.

const base = (name: string, fallback: string) => (process.env[name] || fallback).replace(/\/+$/, "");
const asArray = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/* ---------- GitHub ---------- */

const github = (path: string, token: string, init: RequestInit = {}, signal?: AbortSignal) =>
  callService(
    "GitHub",
    `${base("GITHUB_API_URL", "https://api.github.com")}${path}`,
    { ...init, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}`, "User-Agent": "Omni", ...(init.body ? { "Content-Type": "application/json" } : {}) } },
    signal,
  );

export const githubApi = {
  async validate(token: string, signal?: AbortSignal) {
    const user = asRecord(await github("/user", token, {}, signal));
    if (typeof user.login !== "string") throw new IntegrationError("GitHub returned something unexpected.", "bad_response");
    return { account: `@${user.login}` };
  },
  async listRepos(token: string, signal?: AbortSignal) {
    const repos = asArray(await github("/user/repos?per_page=30&sort=updated", token, {}, signal));
    return repos.map((r) => ({ name: r.full_name, description: trimText(r.description, 200), private: r.private === true, url: r.html_url }));
  },
  async listIssues(token: string, repo: string, state: string, signal?: AbortSignal) {
    const issues = asArray(await github(`/repos/${repo}/issues?state=${encodeURIComponent(state)}&per_page=30`, token, {}, signal));
    return issues.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: trimText(i.title, 200), state: i.state, author: asRecord(i.user).login, comments: i.comments, url: i.html_url }));
  },
  async createIssue(token: string, repo: string, title: string, body: string, signal?: AbortSignal) {
    const issue = asRecord(await github(`/repos/${repo}/issues`, token, { method: "POST", body: JSON.stringify({ title, body }) }, signal));
    return { number: issue.number, url: issue.html_url };
  },
  async comment(token: string, repo: string, number: number, body: string, signal?: AbortSignal) {
    const comment = asRecord(await github(`/repos/${repo}/issues/${number}/comments`, token, { method: "POST", body: JSON.stringify({ body }) }, signal));
    return { url: comment.html_url };
  },
};

/* ---------- Notion ---------- */

const notion = (path: string, token: string, init: RequestInit = {}, signal?: AbortSignal) =>
  callService("Notion", `${base("NOTION_API_URL", "https://api.notion.com")}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", ...(init.body ? { "Content-Type": "application/json" } : {}) } }, signal);

function notionTitle(page: Record<string, unknown>): string {
  for (const property of Object.values(asRecord(page.properties))) {
    const prop = asRecord(property);
    if (prop.type === "title") return trimText(asArray(prop.title).map((t) => (typeof t.plain_text === "string" ? t.plain_text : "")).join(""), 200) || "Untitled";
  }
  return "Untitled";
}

export const notionApi = {
  async validate(token: string, signal?: AbortSignal) {
    const me = asRecord(await notion("/v1/users/me", token, {}, signal));
    const workspace = trimText(asRecord(me.bot).workspace_name, 80);
    return { account: workspace || trimText(me.name, 80) || "Notion workspace" };
  },
  async search(token: string, query: string, signal?: AbortSignal) {
    const data = asRecord(await notion("/v1/search", token, { method: "POST", body: JSON.stringify({ query, page_size: 15, filter: { property: "object", value: "page" } }) }, signal));
    return asArray(data.results).map((page) => ({ id: page.id, title: notionTitle(page), url: page.url, edited: page.last_edited_time }));
  },
  async createPage(token: string, parentPageId: string, title: string, content: string, signal?: AbortSignal) {
    const paragraphs = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 90);
    const children = paragraphs.map((text) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] } }));
    const page = asRecord(await notion("/v1/pages", token, { method: "POST", body: JSON.stringify({ parent: { page_id: parentPageId }, properties: { title: { title: [{ type: "text", text: { content: title.slice(0, 200) } }] } }, children }) }, signal));
    return { id: page.id, url: page.url };
  },
};

/* ---------- Todoist ---------- */

const todoist = (path: string, token: string, init: RequestInit = {}, signal?: AbortSignal) =>
  callService("Todoist", `${base("TODOIST_API_URL", "https://api.todoist.com/rest/v2")}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } }, signal);

export const todoistApi = {
  async validate(token: string, signal?: AbortSignal) {
    const projects = asArray(await todoist("/projects", token, {}, signal));
    return { account: projects.length ? `${projects.length} project${projects.length === 1 ? "" : "s"}` : "Todoist account" };
  },
  async listTasks(token: string, filter: string, signal?: AbortSignal) {
    const tasks = asArray(await todoist(`/tasks${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`, token, {}, signal));
    return tasks.slice(0, 50).map((t) => ({ id: t.id, content: trimText(t.content, 300), due: trimText(asRecord(t.due).string, 60) || null, priority: t.priority, url: t.url }));
  },
  async createTask(token: string, content: string, dueString: string, signal?: AbortSignal) {
    const task = asRecord(await todoist("/tasks", token, { method: "POST", body: JSON.stringify({ content, ...(dueString ? { due_string: dueString } : {}) }) }, signal));
    return { id: task.id, url: task.url };
  },
  async completeTask(token: string, id: string, signal?: AbortSignal) {
    await todoist(`/tasks/${encodeURIComponent(id)}/close`, token, { method: "POST" }, signal);
    return { completed: true };
  },
};

/* ---------- Slack and Discord webhooks ---------- */

const OFFICIAL_PREFIXES: Record<"slack" | "discord", RegExp[]> = {
  slack: [/^https:\/\/hooks\.slack\.com\/(services|triggers|workflows)\/[\w/-]+$/],
  discord: [/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/],
};

/** Webhook addresses are only accepted for the real service (plus any prefix the server operator adds for testing). */
export function isAllowedWebhook(provider: "slack" | "discord", url: string): boolean {
  if (OFFICIAL_PREFIXES[provider].some((pattern) => pattern.test(url))) return true;
  const extra = (process.env.INTEGRATION_EXTRA_WEBHOOK_PREFIX ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return extra.some((prefix) => url.startsWith(prefix) && !/[\s]/.test(url));
}

export const slackApi = {
  /** Slack gives no way to check a webhook without posting, so connecting only checks the address's shape. */
  validate(url: string) {
    return { account: `Webhook ending …${url.slice(-4)}` };
  },
  async post(url: string, text: string, signal?: AbortSignal) {
    const reply = await callService("Slack", url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }, signal);
    if (typeof reply === "string" && reply.trim() !== "ok") throw new IntegrationError("Slack didn't accept the message. The webhook may have been removed.", "bad_request");
    return { posted: true };
  },
};

export const discordApi = {
  /** A GET on a Discord webhook returns its details without posting anything, so this really checks it. */
  async validate(url: string, signal?: AbortSignal) {
    const info = asRecord(await callService("Discord", url, {}, signal));
    if (typeof info.id !== "string") throw new IntegrationError("Discord returned something unexpected for that webhook.", "bad_response");
    return { account: trimText(info.name, 80) || `Webhook ending …${url.slice(-4)}` };
  },
  async post(url: string, content: string, signal?: AbortSignal) {
    await callService("Discord", url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }) }, signal);
    return { posted: true };
  },
};
