import { ApiError } from "@/lib/api-error";
import { actionById, type Provider } from "./catalog";
import { paramsSchema } from "./params";
import { loadCredentials, recordUse, saveConnection } from "./connections";
import { IntegrationError } from "./http";
import { discordApi, githubApi, notionApi, slackApi, todoistApi } from "./providers/simple";
import { googleApi, refresh } from "./providers/google";

async function googleToken(signal?: AbortSignal): Promise<string> {
  const credentials = await loadCredentials("google");
  if (!("accessToken" in credentials)) throw new ApiError(500, "credentials_unreadable", "The saved Google credentials are in an unknown form. Reconnect Google.");
  if (credentials.expiresAt - 60_000 > Date.now()) return credentials.accessToken;
  if (!credentials.refreshToken) throw new IntegrationError("Your Google sign-in expired. Reconnect Google in Integrations.", "rejected");
  const renewed = await refresh(credentials.refreshToken, signal);
  const { prisma } = await import("@/lib/db");
  const row = await prisma.integration.findUnique({ where: { provider: "google" }, select: { account: true, scopes: true } });
  await saveConnection("google", { accessToken: renewed.accessToken, refreshToken: credentials.refreshToken, expiresAt: renewed.expiresAt }, { account: row?.account ?? "Google account", scopes: row?.scopes ?? [], expiresAt: new Date(renewed.expiresAt) });
  return renewed.accessToken;
}

const slackSafe = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function dispatch(id: string, p: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const token = async (provider: Provider) => {
    const credentials = await loadCredentials(provider);
    return "token" in credentials ? credentials.token : "url" in credentials ? credentials.url : "";
  };
  switch (id) {
    case "github.list_repos":
      return githubApi.listRepos(await token("github"), signal);
    case "github.list_issues":
      return githubApi.listIssues(await token("github"), p.repo as string, (p.state as string) ?? "open", signal);
    case "github.create_issue":
      return githubApi.createIssue(await token("github"), p.repo as string, p.title as string, (p.body as string) ?? "", signal);
    case "github.comment":
      return githubApi.comment(await token("github"), p.repo as string, p.number as number, p.body as string, signal);
    case "notion.search":
      return notionApi.search(await token("notion"), p.query as string, signal);
    case "notion.create_page":
      return notionApi.createPage(await token("notion"), p.parentPageId as string, p.title as string, (p.content as string) ?? "", signal);
    case "todoist.list_tasks":
      return todoistApi.listTasks(await token("todoist"), (p.filter as string) ?? "", signal);
    case "todoist.create_task":
      return todoistApi.createTask(await token("todoist"), p.content as string, (p.dueString as string) ?? "", signal);
    case "todoist.complete_task":
      return todoistApi.completeTask(await token("todoist"), p.id as string, signal);
    case "slack.post_message":
      return slackApi.post(await token("slack"), slackSafe(p.text as string), signal);
    case "discord.post_message":
      return discordApi.post(await token("discord"), p.content as string, signal);
    case "gmail.list_messages":
      return googleApi.listMessages(await googleToken(signal), (p.query as string) ?? "", (p.limit as number) ?? 10, signal);
    case "gmail.create_draft":
      return googleApi.createDraft(await googleToken(signal), { to: p.to as string, subject: p.subject as string, body: p.body as string }, signal);
    case "gcal.list_events": {
      const events = await googleApi.listEvents(await googleToken(signal), (p.days as number) ?? 7, signal);
      return events.map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location || undefined }));
    }
    case "gcal.import_events":
      return (await import("./google-import")).importGoogleEvents(await googleToken(signal), (p.days as number) ?? 30, signal);
    case "drive.search":
      return googleApi.searchDrive(await googleToken(signal), p.query as string, signal);
    case "drive.import_to_knowledge":
      return (await import("./google-import")).importDriveFile(await googleToken(signal), p.fileId as string, signal);
    default:
      throw new ApiError(404, "unknown_action", "That action doesn't exist.");
  }
}

/**
 * Runs one action against a connected service. Callers decide whether it needs a person's approval first; this
 * function only checks the input and does the work, and records whether the connection is still working.
 */
export async function runIntegrationAction(id: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
  const action = actionById(id);
  if (!action) throw new ApiError(404, "unknown_action", "That action doesn't exist.");
  const parsed = paramsSchema(action).parse(params ?? {});
  try {
    const result = await dispatch(id, parsed, signal);
    await recordUse(action.provider, null);
    return result;
  } catch (error) {
    if (error instanceof IntegrationError) {
      await recordUse(action.provider, error.message);
      throw new ApiError(error.kind === "rate_limited" ? 429 : error.kind === "rejected" || error.kind === "forbidden" ? 400 : error.kind === "not_found" ? 404 : error.kind === "bad_request" ? 400 : 502, `integration_${error.kind}`, error.message);
    }
    throw error;
  }
}
