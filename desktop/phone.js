// "Connect your phone": a small gate that lets a phone on the same Wi-Fi reach this computer's OMNI server.
// It is off until the user turns it on. While on, it listens on the local network, asks for a 6-digit code once per phone,
// and forwards everything else to the private server (which itself only listens on this computer).
const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");

const PREFERRED_PORT = 47832;
const COOKIE = "omni_phone";
const MAX_WRONG = 5; // wrong codes per address before a one-minute pause
const PAUSE_MS = 60_000;

function localAddress() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list ?? []) if (nic.family === "IPv4" && !nic.internal) found.push(nic.address);
  }
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const page = (body) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OMNI AI</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f2ea;color:#2b2a26;font-family:system-ui,sans-serif">
<main style="width:min(92vw,340px);text-align:center"><div style="font:36px Georgia,serif">Omni</div>${body}</main>`;

function pinPage(message) {
  return page(`<p style="opacity:.7;margin:.6rem 0 1.4rem">Enter the 6-digit code shown on your computer.</p>
<form method="post" action="/__pair"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus required
style="width:100%;box-sizing:border-box;font:600 28px ui-monospace,monospace;letter-spacing:.35em;text-align:center;padding:.6rem;border:1px solid #cfc8b8;border-radius:12px;background:#fff">
<button style="margin-top:1rem;width:100%;padding:.8rem;font:600 16px system-ui;border:0;border-radius:12px;background:#2f6b4a;color:#fff">Connect</button></form>
${message ? `<p style="color:#b3261e;margin-top:1rem">${message}</p>` : ""}`);
}

// The Android app shows "can't reach your server" for any error status on a page, so people's browsers and web views
// get the code page as a normal 200. Everything else (scripts, API calls) still gets the real status.
const wantsPage = (req) => (req.headers.accept ?? "").includes("text/html");
const statusFor = (req, status) => (wantsPage(req) ? 200 : status);

function createPhoneBridge({ targetPort, log }) {
  let listener = null;
  let port = null;
  let code = null;
  const sessions = new Set();
  const wrong = new Map(); // address -> { count, until }

  const state = () => {
    const address = localAddress();
    return { enabled: Boolean(listener), address: listener && address ? `http://${address}:${port}` : null, code: listener ? code : null, hasNetwork: Boolean(address), phones: sessions.size };
  };

  function readBody(req) {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1000) req.destroy();
      });
      req.on("end", () => resolve(data));
      req.on("error", () => resolve(""));
    });
  }

  const cookieOf = (req) => (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

  async function handle(req, res) {
    const who = req.socket.remoteAddress ?? "?";
    const token = cookieOf(req);
    if (token && sessions.has(token)) return forward(req, res);

    if (req.method === "POST" && req.url === "/__pair") {
      const mark = wrong.get(who) ?? { count: 0, until: 0 };
      if (mark.until > Date.now()) {
        res.writeHead(statusFor(req, 429), { "content-type": "text/html" });
        return res.end(pinPage("Too many tries. Wait a minute and try again."));
      }
      const submitted = new URLSearchParams(await readBody(req)).get("code")?.trim() ?? "";
      const a = Buffer.from(submitted);
      const b = Buffer.from(code ?? "");
      if (code && a.length === b.length && crypto.timingSafeEqual(a, b)) {
        wrong.delete(who);
        const session = crypto.randomBytes(24).toString("hex");
        sessions.add(session);
        log(`A phone connected from ${who}`);
        res.writeHead(303, { location: "/", "set-cookie": `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
        return res.end();
      }
      mark.count += 1;
      if (mark.count >= MAX_WRONG) Object.assign(mark, { count: 0, until: Date.now() + PAUSE_MS });
      wrong.set(who, mark);
      res.writeHead(statusFor(req, 401), { "content-type": "text/html" });
      return res.end(pinPage("That code is not right."));
    }

    // Anything else without a session just gets the code page (never any data).
    res.writeHead(statusFor(req, 401), { "content-type": "text/html", "cache-control": "no-store" });
    res.end(pinPage(""));
  }

  function forward(req, res) {
    const upstream = http.request({ host: "127.0.0.1", port: targetPort, method: req.method, path: req.url, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("The OMNI server is not responding.");
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }

  function listen(wanted) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => void handle(req, res).catch(() => res.destroy()));
      server.once("error", (error) => (wanted ? listen(0).then(resolve, reject) : reject(error)));
      server.listen(wanted, "0.0.0.0", () => resolve(server));
    });
  }

  return {
    state,
    async enable() {
      if (listener) return state();
      code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      listener = await listen(PREFERRED_PORT);
      port = listener.address().port;
      log(`Phone access turned on (port ${port})`);
      return state();
    },
    async disable() {
      if (!listener) return state();
      const closing = listener;
      listener = null;
      code = null;
      sessions.clear(); // phones must enter a new code next time
      closing.closeAllConnections?.();
      await new Promise((resolve) => closing.close(resolve));
      log("Phone access turned off");
      return state();
    },
  };
}

module.exports = { createPhoneBridge };
