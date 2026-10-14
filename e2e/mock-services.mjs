// Stand-ins for GitHub, Notion, Todoist, Slack, Discord, and Google, served by the mock server. They check what a real
// service would check (a valid token, the right headers) and record every change so tests can see what was really sent.

const log = [];
const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};
const readBody = async (request) => {
  let raw = "";
  for await (const part of request) raw += part;
  return raw;
};

export async function handleServices(request, response, url) {
  const path = url.pathname;
  const bearer = (request.headers.authorization ?? "").replace(/^Bearer /, "");

  if (path === "/mock/log") return json(response, 200, { log }), true;
  if (path === "/mock/reset") return log.length = 0, json(response, 200, { ok: true }), true;

  /* GitHub */
  if (path.startsWith("/github/")) {
    if (bearer !== "ghp_valid_token") return json(response, 401, { message: "Bad credentials" }), true;
    const api = path.slice("/github".length);
    if (api === "/user") return json(response, 200, { login: "octocat" }), true;
    if (api === "/user/repos") return json(response, 200, [{ full_name: "acme/app", description: "The app", private: false, html_url: "https://github.com/acme/app" }]), true;
    if (api === "/repos/acme/app/issues" && request.method === "GET") {
      return json(response, 200, [{ number: 1, title: "Login page is broken", state: "open", user: { login: "sam" }, comments: 2, html_url: "https://github.com/acme/app/issues/1" }, { number: 2, title: "Add dark mode (PR)", pull_request: {}, state: "open" }]), true;
    }
    if (api === "/repos/acme/app/issues" && request.method === "POST") {
      const body = JSON.parse(await readBody(request));
      log.push({ service: "github", action: "create_issue", body });
      return json(response, 201, { number: 7, html_url: "https://github.com/acme/app/issues/7" }), true;
    }
    return json(response, 404, { message: "Not Found" }), true;
  }

  /* Notion */
  if (path.startsWith("/notion/")) {
    if (bearer !== "secret_valid_notion") return json(response, 401, { message: "API token is invalid." }), true;
    const api = path.slice("/notion".length);
    if (api === "/v1/users/me") return json(response, 200, { object: "user", type: "bot", bot: { workspace_name: "Acme Workspace" } }), true;
    if (api === "/v1/search") return json(response, 200, { results: [{ object: "page", id: "p1", url: "https://notion.so/p1", last_edited_time: "2026-01-01T00:00:00Z", properties: { title: { type: "title", title: [{ plain_text: "Roadmap" }] } } }] }), true;
    if (api === "/v1/pages") {
      log.push({ service: "notion", action: "create_page", body: JSON.parse(await readBody(request)) });
      return json(response, 200, { id: "new", url: "https://notion.so/new" }), true;
    }
    return json(response, 404, {}), true;
  }

  /* Todoist */
  if (path.startsWith("/todoist/rest/v2")) {
    if (bearer !== "todoist_valid") return json(response, 401, "Forbidden"), true;
    const api = path.slice("/todoist/rest/v2".length);
    if (api === "/projects") return json(response, 200, [{ id: "1" }]), true;
    if (api === "/tasks" && request.method === "GET") return json(response, 200, [{ id: "55", content: "Pay rent", due: { string: "today" }, priority: 4, url: "https://todoist.com/55" }]), true;
    if (api === "/tasks" && request.method === "POST") {
      log.push({ service: "todoist", action: "create_task", body: JSON.parse(await readBody(request)) });
      return json(response, 200, { id: "56", url: "https://todoist.com/56" }), true;
    }
    return json(response, 404, {}), true;
  }

  /* Slack and Discord webhooks */
  if (path.startsWith("/hooks/slack/")) {
    if (request.method === "POST") {
      log.push({ service: "slack", action: "post", body: JSON.parse(await readBody(request)) });
      response.writeHead(200, { "Content-Type": "text/plain" });
      return response.end("ok"), true;
    }
    return json(response, 405, {}), true;
  }
  if (path.startsWith("/hooks/discord/")) {
    if (request.method === "GET") return json(response, path.includes("badhook") ? 404 : 200, path.includes("badhook") ? { message: "Unknown Webhook" } : { id: "123", name: "Alerts channel" }), true;
    if (request.method === "POST") {
      log.push({ service: "discord", action: "post", body: JSON.parse(await readBody(request)) });
      response.writeHead(204);
      return response.end(), true;
    }
  }

  /* Google */
  if (path === "/google/auth") {
    const redirect = new URL(url.searchParams.get("redirect_uri"));
    redirect.searchParams.set("state", url.searchParams.get("state"));
    if (url.searchParams.get("login_hint") === "deny") redirect.searchParams.set("error", "access_denied");
    else redirect.searchParams.set("code", `mock-code-${url.searchParams.get("code_challenge")?.slice(0, 6)}`);
    response.writeHead(302, { Location: redirect.toString() });
    return response.end(), true;
  }
  if (path === "/google/token" && request.method === "POST") {
    const form = new URLSearchParams(await readBody(request));
    if (form.get("client_id") !== "e2e-google-client" || form.get("client_secret") !== "e2e-google-secret") return json(response, 401, { error: "invalid_client" }), true;
    if (form.get("grant_type") === "authorization_code" && !form.get("code_verifier")) return json(response, 400, { error: "invalid_grant" }), true;
    return json(response, 200, { access_token: "google-access", refresh_token: "google-refresh", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly" }), true;
  }
  if (path.startsWith("/google/")) {
    if (bearer !== "google-access") return json(response, 401, { error: "unauthorized" }), true;
    const api = path.slice("/google".length);
    if (api === "/userinfo") return json(response, 200, { email: "me@example.com" }), true;
    if (api === "/gmail/users/me/messages") return json(response, 200, { messages: [{ id: "m1" }, { id: "m2" }] }), true;
    if (api.startsWith("/gmail/users/me/messages/")) {
      const id = api.split("/").pop();
      return json(response, 200, { id, snippet: id === "m1" ? "Are we still on for lunch?" : "Your invoice is ready", payload: { headers: [{ name: "From", value: id === "m1" ? "Sam <sam@example.com>" : "Billing <billing@example.com>" }, { name: "Subject", value: id === "m1" ? "Lunch Thursday?" : "Invoice 4821" }, { name: "Date", value: "Tue, 13 Oct 2026 09:00:00 +0000" }] } }), true;
    }
    if (api === "/gmail/users/me/drafts") {
      log.push({ service: "gmail", action: "create_draft", body: JSON.parse(await readBody(request)) });
      return json(response, 200, { id: "draft1" }), true;
    }
    if (api === "/calendar/calendars/primary/events") {
      const next = (days, hour) => new Date(Date.now() + days * 86_400_000 + hour * 3_600_000).toISOString();
      return json(response, 200, { items: [{ id: "g1", summary: "Google standup", start: { dateTime: next(2, 0), timeZone: "UTC" }, end: { dateTime: next(2, 1) }, location: "Meet" }, { id: "g2", summary: "Google offsite", start: { date: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) }, end: { date: new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10) } }] }), true;
    }
    if (api === "/drive/files") return json(response, 200, { files: [{ id: "docfile0001", name: "Quarterly plan", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-10-01T00:00:00Z", webViewLink: "https://docs.google.com/document/d/docfile0001" }] }), true;
    if (api === "/drive/files/docfile0001") return json(response, 200, { name: "Quarterly plan", mimeType: "application/vnd.google-apps.document" }), true;
    if (api === "/drive/files/docfile0001/export") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      return response.end("Our quarterly plan is to launch the beta in spring and hire two engineers."), true;
    }
    return json(response, 404, {}), true;
  }
  return false;
}
