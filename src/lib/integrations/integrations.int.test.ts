// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTool, TOOLS } from "@/lib/agents/tools";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { runIntegrationAction } from "./actions";
import { ACTIONS } from "./catalog";
import { connectWithSecret, disconnect, finishGoogleSignIn, startGoogleSignIn, testConnection } from "./connect";
import { listConnections } from "./connections";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}
const calls: Call[] = [];
let handler: (call: Call) => Response | undefined = () => undefined;
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => Response.json(body, { status });

beforeEach(async () => {
  assertTestDatabase();
  process.env.GOOGLE_CLIENT_ID = "client-id-123";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret-456";
  process.env.INTEGRATION_EXTRA_WEBHOOK_PREFIX = "https://hooks.test/";
  await prisma.integration.deleteMany();
  await prisma.oAuthState.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  calls.length = 0;
  handler = () => undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    const call: Call = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null };
    calls.push(call);
    return handler(call) ?? json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

const lastCall = () => calls.at(-1)!;

describe("token services (database + mocked services)", () => {
  it("checks a GitHub token with GitHub before saving it, and stores it encrypted", async () => {
    handler = (c) => (c.url === "https://api.github.com/user" ? json({ login: "octocat" }) : undefined);
    expect(await connectWithSecret("github", "ghp_secret_token_value_123")).toEqual({ account: "@octocat", verified: true });
    expect(calls[0].headers.authorization).toBe("Bearer ghp_secret_token_value_123");
    const row = await prisma.integration.findUniqueOrThrow({ where: { provider: "github" } });
    expect(row.account).toBe("@octocat");
    expect(row.encryptedCredentials).not.toContain("ghp_secret");
    expect(JSON.stringify(await listConnections())).not.toContain("ghp_secret");
    expect((await listConnections()).find((c) => c.provider === "github")).toMatchObject({ connected: true, account: "@octocat" });
  });

  it("saves nothing when the service rejects the credential, and the message never contains it", async () => {
    handler = () => json({ message: "Bad credentials" }, 401);
    const error = await connectWithSecret("github", "ghp_wrong_token_999").catch((e) => e);
    expect(error).toMatchObject({ status: 400, code: "integration_rejected" });
    expect(error.message).not.toContain("ghp_wrong");
    expect(await prisma.integration.count()).toBe(0);
    await expect(connectWithSecret("github", "   ")).rejects.toMatchObject({ code: "empty_secret" });
    await expect(connectWithSecret("github", "has a space")).rejects.toMatchObject({ code: "invalid_secret" });
  });

  it("reports an unreachable service plainly", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(connectWithSecret("notion", "secret_abc")).rejects.toMatchObject({ code: "integration_unavailable", message: "Notion couldn't be reached." });
  });

  it("lists issues without pull requests, opens issues, and comments", async () => {
    handler = (c) => (c.url === "https://api.github.com/user" ? json({ login: "me" }) : undefined);
    await connectWithSecret("github", "ghp_token_abcdef");
    handler = (c) => {
      if (c.url.startsWith("https://api.github.com/repos/acme/app/issues?")) return json([{ number: 1, title: "A bug", state: "open", user: { login: "sam" }, comments: 2, html_url: "https://github.com/acme/app/issues/1" }, { number: 2, title: "A PR", pull_request: {}, state: "open" }]);
      if (c.url === "https://api.github.com/repos/acme/app/issues" && c.method === "POST") return json({ number: 3, html_url: "https://github.com/acme/app/issues/3" }, 201);
      if (c.url === "https://api.github.com/repos/acme/app/issues/3/comments") return json({ html_url: "https://github.com/acme/app/issues/3#c1" }, 201);
      return undefined;
    };
    const issues = (await runIntegrationAction("github.list_issues", { repo: "acme/app", state: "open" })) as { number: number }[];
    expect(issues.map((i) => i.number)).toEqual([1]);
    expect(await runIntegrationAction("github.create_issue", { repo: "acme/app", title: "New thing", body: "Details" })).toEqual({ number: 3, url: "https://github.com/acme/app/issues/3" });
    expect(JSON.parse(lastCall().body!)).toEqual({ title: "New thing", body: "Details" });
    expect(await runIntegrationAction("github.comment", { repo: "acme/app", number: "3", body: "Thanks" })).toEqual({ url: "https://github.com/acme/app/issues/3#c1" });
    expect((await listConnections()).find((c) => c.provider === "github")!.lastUsedAt).not.toBeNull();
  });

  it("refuses made-up repositories and other bad input before any request is made", async () => {
    handler = () => json({ login: "me" });
    await connectWithSecret("github", "ghp_token_abcdef");
    calls.length = 0;
    for (const params of [{ repo: "../../user" }, { repo: "owner" }, { repo: "a/b/c" }, { repo: "a/b?x=1" }]) {
      await expect(runIntegrationAction("github.list_issues", params), JSON.stringify(params)).rejects.toBeTruthy();
    }
    await expect(runIntegrationAction("github.comment", { repo: "a/b", number: "0", body: "x" })).rejects.toBeTruthy();
    await expect(runIntegrationAction("nope.nothing", {})).rejects.toMatchObject({ code: "unknown_action" });
    expect(calls).toHaveLength(0);
  });

  it("won't run an action for a service that isn't connected", async () => {
    await expect(runIntegrationAction("todoist.list_tasks", {})).rejects.toMatchObject({ code: "not_connected" });
    expect(calls).toHaveLength(0);
  });

  it("searches Notion by title, and builds a page from paragraphs", async () => {
    handler = (c) => (c.url.endsWith("/v1/users/me") ? json({ bot: { workspace_name: "My Space" } }) : undefined);
    expect((await connectWithSecret("notion", "secret_notion_1")).account).toBe("My Space");
    handler = (c) => {
      if (c.url.endsWith("/v1/search")) return json({ results: [{ id: "p1", url: "https://notion.so/p1", last_edited_time: "2026-01-01", properties: { Name: { type: "title", title: [{ plain_text: "Plans" }, { plain_text: " 2026" }] } } }] });
      if (c.url.endsWith("/v1/pages")) return json({ id: "new1", url: "https://notion.so/new1" });
      return undefined;
    };
    expect(await runIntegrationAction("notion.search", { query: "plans" })).toEqual([{ id: "p1", title: "Plans 2026", url: "https://notion.so/p1", edited: "2026-01-01" }]);
    expect(lastCall().headers["notion-version"]).toBe("2022-06-28");
    await runIntegrationAction("notion.create_page", { parentPageId: "0123456789abcdef0123456789abcdef", title: "Notes", content: "One\n\nTwo" });
    const body = JSON.parse(lastCall().body!);
    expect(body.parent).toEqual({ page_id: "0123456789abcdef0123456789abcdef" });
    expect(body.children).toHaveLength(2);
    await expect(runIntegrationAction("notion.create_page", { parentPageId: "not-an-id", title: "x" })).rejects.toBeTruthy();
  });

  it("lists, adds, and completes Todoist tasks", async () => {
    handler = (c) => (c.url.endsWith("/projects") ? json([{ id: "1" }, { id: "2" }]) : undefined);
    expect((await connectWithSecret("todoist", "todoist_token_1")).account).toBe("2 projects");
    handler = (c) => {
      if (c.url.includes("/tasks?filter=today")) return json([{ id: "9", content: "Pay rent", due: { string: "today" }, priority: 4, url: "https://todoist.com/9" }]);
      if (c.url.endsWith("/tasks") && c.method === "POST") return json({ id: "10", url: "https://todoist.com/10" });
      if (c.url.endsWith("/tasks/10/close")) return new Response(null, { status: 204 });
      return undefined;
    };
    expect(await runIntegrationAction("todoist.list_tasks", { filter: "today" })).toEqual([{ id: "9", content: "Pay rent", due: "today", priority: 4, url: "https://todoist.com/9" }]);
    await runIntegrationAction("todoist.create_task", { content: "Buy milk", dueString: "tomorrow" });
    expect(JSON.parse(lastCall().body!)).toEqual({ content: "Buy milk", due_string: "tomorrow" });
    expect(await runIntegrationAction("todoist.complete_task", { id: "10" })).toEqual({ completed: true });
    await expect(runIntegrationAction("todoist.complete_task", { id: "../projects" })).rejects.toBeTruthy();
  });
});

describe("webhook services (database + mocked services)", () => {
  it("accepts only real Slack addresses, says it can't verify them, and escapes message text", async () => {
    await expect(connectWithSecret("slack", "https://evil.example/hook")).rejects.toMatchObject({ code: "invalid_webhook" });
    await expect(connectWithSecret("slack", "https://hooks.slack.com.evil.example/services/T/B/x")).rejects.toMatchObject({ code: "invalid_webhook" });
    expect(await connectWithSecret("slack", "https://hooks.slack.com/services/T000/B000/abcd1234")).toEqual({ account: "Webhook ending …1234", verified: false });
    expect(calls).toHaveLength(0);
    handler = () => new Response("ok");
    await runIntegrationAction("slack.post_message", { text: "Heads up <!channel> & <https://x.test|click>" });
    expect(JSON.parse(lastCall().body!).text).toBe("Heads up &lt;!channel&gt; &amp; &lt;https://x.test|click&gt;");
    handler = () => new Response("invalid_token", { status: 200 });
    await expect(runIntegrationAction("slack.post_message", { text: "hi" })).rejects.toMatchObject({ message: expect.stringMatching(/didn't accept the message/) });
    await expect(testConnection("slack")).rejects.toMatchObject({ code: "cannot_test" });
  });

  it("checks a Discord webhook with a harmless GET, and posts without allowing mass mentions", async () => {
    await expect(connectWithSecret("discord", "https://example.com/api/webhooks/1/abc")).rejects.toMatchObject({ code: "invalid_webhook" });
    handler = (c) => (c.method === "GET" ? json({ id: "123", name: "Alerts" }) : undefined);
    expect(await connectWithSecret("discord", "https://discord.com/api/webhooks/123/token_abc-XYZ")).toEqual({ account: "Alerts", verified: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    handler = () => new Response(null, { status: 204 });
    await runIntegrationAction("discord.post_message", { content: "@everyone hello" });
    expect(JSON.parse(lastCall().body!)).toEqual({ content: "@everyone hello", allowed_mentions: { parse: [] } });
  });

  it("can be tested, and then disconnected, which deletes the credentials", async () => {
    handler = (c) => (c.method === "GET" ? json({ id: "1", name: "Alerts" }) : undefined);
    await connectWithSecret("discord", "https://discord.com/api/webhooks/1/abcdef");
    expect((await testConnection("discord")).account).toBe("Alerts");
    handler = () => json({}, 401);
    await expect(testConnection("discord")).rejects.toMatchObject({ code: "integration_rejected" });
    expect((await listConnections()).find((c) => c.provider === "discord")!.lastError).toMatch(/rejected the saved credentials/);
    await disconnect("discord");
    expect(await prisma.integration.count()).toBe(0);
    await expect(runIntegrationAction("discord.post_message", { content: "x" })).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("Google (database + mocked Google)", () => {
  const request = new Request("http://localhost:3000/api/integrations/google/start");

  async function signIn(scopeSet: "read" | "drafts" = "read") {
    const url = new URL(await startGoogleSignIn(request, scopeSet));
    handler = (c) => {
      if (c.url === "https://oauth2.googleapis.com/token") return json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.readonly" });
      if (c.url === "https://www.googleapis.com/oauth2/v3/userinfo") return json({ email: "me@example.com" });
      return undefined;
    };
    return { url, account: await finishGoogleSignIn(request, { code: "code-xyz", state: url.searchParams.get("state"), error: null }) };
  }

  it("starts sign-in with PKCE and a one-time state, asking only for the access you chose", async () => {
    const readUrl = new URL(await startGoogleSignIn(request, "read"));
    expect(readUrl.origin + readUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(readUrl.searchParams.get("client_id")).toBe("client-id-123");
    expect(readUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/google/callback");
    expect(readUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(readUrl.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(readUrl.searchParams.get("scope")).not.toContain("gmail.compose");
    expect(readUrl.searchParams.get("scope")).toContain("gmail.readonly");
    const draftsUrl = new URL(await startGoogleSignIn(request, "drafts"));
    expect(draftsUrl.searchParams.get("scope")).toContain("gmail.compose");
    expect(draftsUrl.searchParams.get("scope")).not.toContain("gmail.send");
    expect(await prisma.oAuthState.count()).toBe(2);
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(startGoogleSignIn(request, "read")).rejects.toMatchObject({ code: "google_not_configured" });
  });

  it("finishes sign-in by proving the verifier, stores tokens encrypted, and never accepts a state twice", async () => {
    const { url, account } = await signIn();
    expect(account.account).toBe("me@example.com");
    const tokenCall = calls.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    const form = new URLSearchParams(tokenCall.body!);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-xyz");
    expect(form.get("code_verifier")).toMatch(/^[\w-]{20,}$/);
    const row = await prisma.integration.findUniqueOrThrow({ where: { provider: "google" } });
    expect(row.encryptedCredentials).not.toContain("access-1");
    expect(row.encryptedCredentials).not.toContain("refresh-1");
    expect(row.scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
    await expect(finishGoogleSignIn(request, { code: "again", state: url.searchParams.get("state"), error: null })).rejects.toMatchObject({ code: "google_invalid" });
    await expect(finishGoogleSignIn(request, { code: "x", state: "forged-state", error: null })).rejects.toMatchObject({ code: "google_invalid" });
    await expect(finishGoogleSignIn(request, { code: null, state: null, error: "access_denied" })).rejects.toMatchObject({ code: "google_denied" });
  });

  it("ignores a sign-in attempt that's too old", async () => {
    const url = new URL(await startGoogleSignIn(request, "read"));
    await prisma.oAuthState.updateMany({ data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await expect(finishGoogleSignIn(request, { code: "c", state: url.searchParams.get("state"), error: null })).rejects.toMatchObject({ code: "google_invalid" });
    expect(await prisma.integration.count()).toBe(0);
  });

  it("renews an expired access token with the refresh token and keeps working", async () => {
    await signIn();
    const { saveConnection } = await import("./connections");
    await saveConnection("google", { accessToken: "stale", refreshToken: "refresh-1", expiresAt: Date.now() - 1000 }, { account: "me@example.com" });
    calls.length = 0;
    handler = (c) => {
      if (c.url === "https://oauth2.googleapis.com/token") return json({ access_token: "fresh", expires_in: 3600 });
      if (c.url.startsWith("https://www.googleapis.com/calendar/v3/")) return json({ items: [] });
      return undefined;
    };
    await runIntegrationAction("gcal.list_events", { days: 3 });
    expect(new URLSearchParams(calls.find((c) => c.url.includes("oauth2"))!.body!).get("grant_type")).toBe("refresh_token");
    expect(lastCall().headers.authorization).toBe("Bearer fresh");
    await runIntegrationAction("gcal.list_events", { days: 3 });
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  it("lists mail metadata only, and builds drafts that can't inject headers", async () => {
    await signIn("drafts");
    handler = (c) => {
      if (c.url.includes("/users/me/messages?")) return json({ messages: [{ id: "m1" }] });
      if (c.url.includes("/users/me/messages/m1")) return json({ id: "m1", snippet: "Hello there", payload: { headers: [{ name: "From", value: "Sam <sam@x.test>" }, { name: "Subject", value: "Lunch?" }, { name: "Date", value: "Mon, 1 Jan 2026" }] } });
      if (c.url.endsWith("/users/me/drafts")) return json({ id: "d1" });
      return undefined;
    };
    expect(await runIntegrationAction("gmail.list_messages", { query: "is:unread", limit: "5" })).toEqual([{ id: "m1", from: "Sam <sam@x.test>", subject: "Lunch?", date: "Mon, 1 Jan 2026", preview: "Hello there" }]);
    expect(calls.some((c) => c.url.includes("format=metadata"))).toBe(true);
    expect(calls.some((c) => c.url.includes("format=full"))).toBe(false);
    const result = (await runIntegrationAction("gmail.create_draft", { to: "friend@example.com", subject: "Hi\r\nBcc: evil@x.test", body: "Hello" })) as { note: string };
    expect(result.note).toMatch(/not been sent/);
    const raw = Buffer.from(JSON.parse(lastCall().body!).message.raw, "base64url").toString();
    const headerBlock = raw.split("\r\n\r\n")[0];
    expect(headerBlock).not.toMatch(/^Bcc:/m);
    expect(headerBlock).toContain("To: friend@example.com");
    expect(calls.some((c) => c.url.includes("/send"))).toBe(false);
    await expect(runIntegrationAction("gmail.create_draft", { to: "a@x.test, b@x.test", subject: "s", body: "b" })).rejects.toBeTruthy();
    await expect(runIntegrationAction("gmail.create_draft", { to: "x@y.z\nBcc: evil@x.test", subject: "s", body: "b" })).rejects.toBeTruthy();
  });

  it("imports Google Calendar events into Omni without duplicating them on a second run", async () => {
    await signIn();
    const items = [
      { id: "e1", summary: "Team sync", start: { dateTime: "2030-03-01T10:00:00+01:00", timeZone: "Europe/Paris" }, end: { dateTime: "2030-03-01T11:00:00+01:00" }, location: "Room 1" },
      { id: "e2", summary: "Holiday", start: { date: "2030-03-05" }, end: { date: "2030-03-07" } },
      { id: "e3", summary: "Cancelled", status: "cancelled", start: { dateTime: "2030-03-02T10:00:00Z" }, end: { dateTime: "2030-03-02T11:00:00Z" } },
    ];
    handler = (c) => (c.url.startsWith("https://www.googleapis.com/calendar/v3/") ? json({ items }) : undefined);
    expect(await runIntegrationAction("gcal.import_events", { days: 30 })).toEqual({ found: 2, created: 2, updated: 0 });
    const holiday = await prisma.calendarEvent.findFirstOrThrow({ where: { title: "Holiday" } });
    expect(holiday.allDay).toBe(true);
    expect(holiday.startsAt.toISOString()).toBe("2030-03-05T00:00:00.000Z");
    expect(holiday.endsAt.toISOString()).toBe("2030-03-07T00:00:00.000Z");
    items[0].summary = "Team sync (moved)";
    expect(await runIntegrationAction("gcal.import_events", { days: 30 })).toEqual({ found: 2, created: 0, updated: 2 });
    expect(await prisma.calendarEvent.count()).toBe(2);
    expect((await prisma.calendarEvent.findFirstOrThrow({ where: { title: { startsWith: "Team sync" } } })).title).toBe("Team sync (moved)");
  });

  it("searches Drive with the query escaped, and adds Google Docs and text files to Knowledge", async () => {
    await signIn();
    handler = (c) => {
      if (c.url.includes("/drive/v3/files?")) return json({ files: [{ id: "f1", name: "Plan", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-01-01", webViewLink: "https://docs.google.com/f1" }] });
      if (c.url.includes("/files/docfile00?fields")) return json({ name: "Plan", mimeType: "application/vnd.google-apps.document" });
      if (c.url.includes("/files/docfile00/export")) return new Response("The plan is to ship in spring.", { headers: { "Content-Type": "text/plain" } });
      if (c.url.includes("/files/pdffile00?fields")) return json({ name: "Scan", mimeType: "application/pdf" });
      return undefined;
    };
    await runIntegrationAction("drive.search", { query: "it's a \\ test" });
    expect(new URL(lastCall().url).searchParams.get("q")).toBe("name contains 'it\\'s a \\\\ test' and trashed = false");
    expect(await runIntegrationAction("drive.import_to_knowledge", { fileId: "docfile00" })).toMatchObject({ name: "Drive: Plan", truncated: false });
    expect((await prisma.knowledgeDocument.findFirstOrThrow()).name).toBe("Drive: Plan");
    await expect(runIntegrationAction("drive.import_to_knowledge", { fileId: "pdffile00" })).rejects.toMatchObject({ message: expect.stringMatching(/only Google Docs and text files/) });
    await expect(runIntegrationAction("drive.import_to_knowledge", { fileId: "../etc/passwd" })).rejects.toBeTruthy();
  });
});

describe("agents and the catalog", () => {
  it("gives every action an agent tool, and makes anything that changes something outside Omni a write tool", () => {
    for (const action of ACTIONS) {
      const tool = getTool(action.id.replace(".", "_"));
      expect(tool, action.id).toBeTruthy();
      expect(tool!.risk).toBe(action.risk);
    }
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
    expect(ACTIONS.filter((a) => a.id.includes("post_message") || a.id.includes("create") || a.id.includes("comment")).every((a) => a.risk === "write")).toBe(true);
  });

  it("has no tool that sends email, and the Email Agent can only draft", async () => {
    expect(TOOLS.some((tool) => /send/.test(tool.name) && !/post/.test(tool.name))).toBe(false);
    const { BUILT_IN_AGENTS, approvalFor } = await import("@/lib/agents/builtins");
    const email = BUILT_IN_AGENTS.find((agent) => agent.key === "email-agent")!;
    expect(email.tools).toContain("gmail_create_draft");
    expect(approvalFor(email.tools)).toEqual(expect.arrayContaining(["gmail_create_draft", "create_task"]));
  });
});
