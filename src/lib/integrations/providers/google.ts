import { createHash, randomBytes } from "node:crypto";
import { callService, IntegrationError, trimText } from "../http";

// Google sign-in (OAuth with PKCE) and the Gmail, Calendar, and Drive calls built on it. Every address can be pointed at a
// test server through an environment variable; by default they are Google's own.

const url = (name: string, fallback: string) => (process.env[name] || fallback).replace(/\/+$/, "");
export const googleUrls = () => ({
  auth: url("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
  token: url("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
  userinfo: url("GOOGLE_USERINFO_URL", "https://www.googleapis.com/oauth2/v3/userinfo"),
  gmail: url("GMAIL_API_URL", "https://gmail.googleapis.com/gmail/v1"),
  calendar: url("GCAL_API_URL", "https://www.googleapis.com/calendar/v3"),
  drive: url("GDRIVE_API_URL", "https://www.googleapis.com/drive/v3"),
});

export function googleClient(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const b64url = (buffer: Buffer) => buffer.toString("base64url");

export function newPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(24)) };
}

export function authorizeUrl(input: { clientId: string; redirectUri: string; scopes: string[]; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: ["openid", "email", ...input.scopes].join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    // Ask for a refresh token every time, so a reconnect always leaves a working connection.
    prompt: "consent",
    include_granted_scopes: "false",
  });
  return `${googleUrls().auth}?${params}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
}

async function tokenRequest(body: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const reply = (await callService("Google", googleUrls().token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }, signal)) as Record<string, unknown> | null;
  if (!reply || typeof reply.access_token !== "string") throw new IntegrationError("Google didn't return a sign-in token.", "bad_response");
  return reply;
}

export async function exchangeCode(input: { code: string; verifier: string; redirectUri: string; signal?: AbortSignal }): Promise<GoogleTokens & { email: string }> {
  const client = googleClient();
  if (!client) throw new IntegrationError("Google sign-in isn't set up on this server.", "bad_request");
  const reply = await tokenRequest({ grant_type: "authorization_code", code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri, client_id: client.clientId, client_secret: client.clientSecret }, input.signal);
  const accessToken = reply.access_token as string;
  const info = (await callService("Google", googleUrls().userinfo, { headers: { Authorization: `Bearer ${accessToken}` } }, input.signal)) as Record<string, unknown> | null;
  return {
    accessToken,
    refreshToken: typeof reply.refresh_token === "string" ? reply.refresh_token : null,
    expiresAt: Date.now() + Number(reply.expires_in ?? 3600) * 1000,
    scopes: typeof reply.scope === "string" ? reply.scope.split(" ").filter((scope) => scope.startsWith("https://")) : [],
    email: trimText(info?.email, 200) || "Google account",
  };
}

export async function refresh(refreshToken: string, signal?: AbortSignal): Promise<{ accessToken: string; expiresAt: number }> {
  const client = googleClient();
  if (!client) throw new IntegrationError("Google sign-in isn't set up on this server.", "bad_request");
  const reply = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret }, signal);
  return { accessToken: reply.access_token as string, expiresAt: Date.now() + Number(reply.expires_in ?? 3600) * 1000 };
}

const asArray = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const authed = (token: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });

/** Strips line breaks from a header value, so a subject or address can't add headers to the email. */
export const headerSafe = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export function buildRawEmail(input: { to: string; subject: string; body: string }): string {
  const message = [`To: ${headerSafe(input.to)}`, `Subject: =?UTF-8?B?${Buffer.from(headerSafe(input.subject)).toString("base64")}?=`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", input.body].join("\r\n");
  return b64url(Buffer.from(message));
}

export const googleApi = {
  async listMessages(token: string, query: string, limit: number, signal?: AbortSignal) {
    const g = googleUrls();
    const list = asRecord(await callService("Gmail", `${g.gmail}/users/me/messages?${new URLSearchParams({ maxResults: String(limit), ...(query ? { q: query } : {}) })}`, authed(token), signal));
    const out = [];
    for (const item of asArray(list.messages).slice(0, limit)) {
      const message = asRecord(await callService("Gmail", `${g.gmail}/users/me/messages/${encodeURIComponent(String(item.id))}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, authed(token), signal));
      const headers = Object.fromEntries(asArray(asRecord(message.payload).headers).map((h) => [String(h.name).toLowerCase(), trimText(h.value, 200)]));
      out.push({ id: message.id, from: headers.from ?? "", subject: headers.subject ?? "(no subject)", date: headers.date ?? "", preview: trimText(message.snippet, 240) });
    }
    return out;
  },
  async createDraft(token: string, input: { to: string; subject: string; body: string }, signal?: AbortSignal) {
    const draft = asRecord(await callService("Gmail", `${googleUrls().gmail}/users/me/drafts`, authed(token, { method: "POST", body: JSON.stringify({ message: { raw: buildRawEmail(input) } }) }), signal));
    return { draftId: draft.id, note: "Saved as a draft in Gmail. It has not been sent." };
  },
  async listEvents(token: string, days: number, signal?: AbortSignal) {
    const now = new Date();
    const params = new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + days * 86_400_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
    const data = asRecord(await callService("Google Calendar", `${googleUrls().calendar}/calendars/primary/events?${params}`, authed(token), signal));
    return asArray(data.items).map((event) => {
      const start = asRecord(event.start);
      const end = asRecord(event.end);
      return {
        id: String(event.id),
        title: trimText(event.summary, 200) || "(no title)",
        description: trimText(event.description, 2000),
        location: trimText(event.location, 300),
        allDay: typeof start.date === "string",
        start: String(start.dateTime ?? start.date ?? ""),
        end: String(end.dateTime ?? end.date ?? ""),
        timezone: typeof start.timeZone === "string" ? start.timeZone : "UTC",
        status: event.status,
      };
    }).filter((event) => event.status !== "cancelled" && event.start);
  },
  async searchDrive(token: string, query: string, signal?: AbortSignal) {
    const safe = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const params = new URLSearchParams({ q: `name contains '${safe}' and trashed = false`, pageSize: "15", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
    const data = asRecord(await callService("Google Drive", `${googleUrls().drive}/files?${params}`, authed(token), signal));
    return asArray(data.files).map((f) => ({ id: f.id, name: trimText(f.name, 200), type: f.mimeType, modified: f.modifiedTime, url: f.webViewLink }));
  },
  async readDriveText(token: string, fileId: string, signal?: AbortSignal): Promise<{ name: string; text: string }> {
    const g = googleUrls();
    const meta = asRecord(await callService("Google Drive", `${g.drive}/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size`, authed(token), signal));
    const mime = String(meta.mimeType ?? "");
    let endpoint: string;
    if (mime === "application/vnd.google-apps.document") endpoint = `${g.drive}/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`;
    else if (mime.startsWith("text/") || mime === "application/json" || mime === "text/markdown") endpoint = `${g.drive}/files/${encodeURIComponent(fileId)}?alt=media`;
    else throw new IntegrationError(`That file is a ${mime || "file"}, and only Google Docs and text files can be added. Download other files and upload them in Knowledge.`, "bad_request");
    const text = await callService("Google Drive", endpoint, authed(token), signal);
    return { name: trimText(meta.name, 200) || "Drive file", text: typeof text === "string" ? text : JSON.stringify(text, null, 2) };
  },
};
