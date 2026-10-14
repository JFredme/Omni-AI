// Runs the end-to-end suite: mock OpenRouter, a fresh e2e database, a production build of the app,
// then the browser tests (e2e/auth.mjs, e2e/smoke.mjs, e2e/chat.mjs, e2e/productivity.mjs, and e2e/agents.mjs). Requires Google Chrome installed.
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 4010);
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgresql://joshy@localhost:5432/omni_ai_e2e";
const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
const baseUrl = `http://localhost:${APP_PORT}`;

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  ENCRYPTION_KEY: "e2e-encryption-secret-0123456789-abcdef",
  OPENROUTER_BASE_URL: `http://localhost:${MOCK_PORT}/api/v1`,
  OPENROUTER_API_KEY: "",
  MOCK_PORT: String(MOCK_PORT),
  OMNI_BASE_URL: baseUrl,
};

const children = [];
function start(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: ["ignore", "inherit", "inherit"], detached: true, ...options });
  children.push(child);
  return child;
}
function stopAll() {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already exited.
    }
  }
}

function runOrFail(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) {
    stopAll();
    process.exit(result.status ?? 1);
  }
}

async function waitForHttp(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  spawnSync("createdb", [dbName], { stdio: "ignore" });
  runOrFail("npx", ["prisma", "migrate", "deploy"]);
  runOrFail("node", ["scripts/clear-test-data.mjs"]);
  runOrFail("npm", ["run", "build"]);

  start("node", ["e2e/mock-openrouter.mjs"]);
  start("npx", ["next", "start", "-p", String(APP_PORT)]);
  await waitForHttp(`${baseUrl}/`);
  await waitForHttp(`http://localhost:${MOCK_PORT}/api/v1/models`);

  runOrFail("node", ["e2e/auth.mjs"]);

  // Sign in once; every other suite reuses this session.
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.E2E_PASSWORD ?? "e2e-password-123" }),
  });
  const cookie = login.headers.get("set-cookie")?.match(/omni_session=([^;]+)/)?.[1];
  if (!login.ok || !cookie) throw new Error(`Could not sign in for the e2e run (HTTP ${login.status}).`);
  env.E2E_SESSION = decodeURIComponent(cookie);

  runOrFail("node", ["e2e/smoke.mjs"]);
  runOrFail("node", ["e2e/chat.mjs"]);
  runOrFail("node", ["e2e/productivity.mjs"]);
  runOrFail("node", ["e2e/agents.mjs"]);
  console.log("\nAll end-to-end suites passed.");
} finally {
  stopAll();
}
