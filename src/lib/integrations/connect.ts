import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { PROVIDER_INFO, GOOGLE_SCOPE_SETS, type GoogleScopeSet, type Provider } from "./catalog";
import { deleteConnection, loadCredentials, recordUse, saveConnection } from "./connections";
import { IntegrationError } from "./http";
import { authorizeUrl, exchangeCode, googleClient, newPkce } from "./providers/google";
import { discordApi, githubApi, isAllowedWebhook, notionApi, slackApi, todoistApi } from "./providers/simple";

const toApiError = (error: unknown): never => {
  if (error instanceof IntegrationError) throw new ApiError(error.kind === "rejected" ? 400 : error.kind === "rate_limited" ? 429 : 502, `integration_${error.kind}`, error.message);
  throw error;
};

export interface ConnectResult {
  account: string;
  /** False when the service gives no way to check the connection without acting (Slack webhooks). */
  verified: boolean;
}

/** Connects a token- or webhook-based service. Nothing is saved unless the service accepts the credential. */
export async function connectWithSecret(provider: Provider, rawSecret: string, signal?: AbortSignal): Promise<ConnectResult> {
  const info = PROVIDER_INFO[provider];
  const value = rawSecret.trim();
  if (!value) throw new ApiError(400, "empty_secret", `Paste your ${info.secretLabel?.toLowerCase() ?? "credential"} first.`);
  if (value.length > 600 || /\s/.test(value)) throw new ApiError(400, "invalid_secret", `That doesn't look like a ${info.secretLabel?.toLowerCase() ?? "credential"}.`);
  try {
    switch (provider) {
      case "github": {
        const { account } = await githubApi.validate(value, signal);
        await saveConnection("github", { token: value }, { account });
        return { account, verified: true };
      }
      case "notion": {
        const { account } = await notionApi.validate(value, signal);
        await saveConnection("notion", { token: value }, { account });
        return { account, verified: true };
      }
      case "todoist": {
        const { account } = await todoistApi.validate(value, signal);
        await saveConnection("todoist", { token: value }, { account });
        return { account, verified: true };
      }
      case "slack": {
        if (!isAllowedWebhook("slack", value)) throw new ApiError(400, "invalid_webhook", "That isn't a Slack webhook address. It should start with https://hooks.slack.com/.");
        const { account } = slackApi.validate(value);
        await saveConnection("slack", { url: value }, { account });
        return { account, verified: false };
      }
      case "discord": {
        if (!isAllowedWebhook("discord", value)) throw new ApiError(400, "invalid_webhook", "That isn't a Discord webhook address. It should start with https://discord.com/api/webhooks/.");
        const { account } = await discordApi.validate(value, signal);
        await saveConnection("discord", { url: value }, { account });
        return { account, verified: true };
      }
      default:
        throw new ApiError(400, "not_token_based", "That service connects through its own sign-in page.");
    }
  } catch (error) {
    return toApiError(error);
  }
}

/** Checks that a saved connection still works, by making a harmless read-only call. */
export async function testConnection(provider: Provider, signal?: AbortSignal): Promise<ConnectResult> {
  const credentials = await loadCredentials(provider);
  try {
    let result: ConnectResult;
    if (provider === "github" && "token" in credentials) result = { ...(await githubApi.validate(credentials.token, signal)), verified: true };
    else if (provider === "notion" && "token" in credentials) result = { ...(await notionApi.validate(credentials.token, signal)), verified: true };
    else if (provider === "todoist" && "token" in credentials) result = { ...(await todoistApi.validate(credentials.token, signal)), verified: true };
    else if (provider === "discord" && "url" in credentials) result = { ...(await discordApi.validate(credentials.url, signal)), verified: true };
    else if (provider === "slack") throw new ApiError(400, "cannot_test", "Slack can't check a webhook without posting a message. Send a test message from the actions below to confirm it works.");
    else if (provider === "google") {
      const { runIntegrationAction } = await import("./actions");
      await runIntegrationAction("gcal.list_events", { days: 1 }, signal);
      const row = await prisma.integration.findUnique({ where: { provider: "google" }, select: { account: true } });
      result = { account: row?.account ?? "Google account", verified: true };
    } else throw new ApiError(400, "cannot_test", "That connection can't be tested.");
    await recordUse(provider, null);
    return result;
  } catch (error) {
    if (error instanceof IntegrationError) await recordUse(provider, error.message);
    return toApiError(error);
  }
}

export async function disconnect(provider: Provider): Promise<void> {
  await deleteConnection(provider);
}

/* ---------- Google sign-in ---------- */

const STATE_TTL_MS = 10 * 60_000;

export function redirectUriFor(request: Request): string {
  const origin = (process.env.OMNI_PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
  return `${origin}/api/integrations/google/callback`;
}

export async function startGoogleSignIn(request: Request, scopeSet: GoogleScopeSet): Promise<string> {
  const client = googleClient();
  if (!client) throw new ApiError(400, "google_not_configured", "Google sign-in isn't set up on this server. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first.");
  const { verifier, challenge, state } = newPkce();
  await prisma.oAuthState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - STATE_TTL_MS) } } });
  await prisma.oAuthState.create({ data: { state, provider: "google", verifier, scopeSet } });
  return authorizeUrl({ clientId: client.clientId, redirectUri: redirectUriFor(request), scopes: [...GOOGLE_SCOPE_SETS[scopeSet].scopes], state, challenge });
}

/** Finishes sign-in: the state must be one we issued, recent, and used only once. */
export async function finishGoogleSignIn(request: Request, input: { code: string | null; state: string | null; error: string | null }): Promise<{ account: string }> {
  if (input.error) throw new ApiError(400, "google_denied", input.error === "access_denied" ? "You didn't allow access, so Google wasn't connected." : "Google couldn't complete the sign-in.");
  if (!input.code || !input.state) throw new ApiError(400, "google_invalid", "That sign-in link is incomplete. Start again from Integrations.");
  const row = await prisma.oAuthState.findUnique({ where: { state: input.state } });
  // Delete first so a state can never be replayed, even if the exchange below fails.
  await prisma.oAuthState.deleteMany({ where: { state: input.state } });
  if (!row || row.provider !== "google" || Date.now() - row.createdAt.getTime() > STATE_TTL_MS) throw new ApiError(400, "google_invalid", "That sign-in attempt expired or wasn't started here. Start again from Integrations.");
  try {
    const tokens = await exchangeCode({ code: input.code, verifier: row.verifier, redirectUri: redirectUriFor(request) });
    await saveConnection("google", { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }, { account: tokens.email, scopes: tokens.scopes, expiresAt: new Date(tokens.expiresAt) });
    return { account: tokens.email };
  } catch (error) {
    return toApiError(error);
  }
}
