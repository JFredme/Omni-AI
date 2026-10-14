// Gathers what the desktop app ships: the built OMNI server, its static files, and the database migrations.
// Run from the desktop folder after `OMNI_DESKTOP_BUILD=1 npm run build` in the project root (or let this script do the build).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const build = join(root, ".next-desktop");

if (process.env.SKIP_BUILD !== "1") {
  const result = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, OMNI_DESKTOP_BUILD: "1" } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(join(build, "standalone", "server.js"))) throw new Error("No standalone build found. Build with OMNI_DESKTOP_BUILD=1 first.");

// Settings read from the environment must be decided per visit. If this route was built ahead of time, the sign-in setting
// would be frozen to whatever the build machine had.
if (existsSync(join(build, "server", "app", "api", "auth", "status.body"))) {
  throw new Error("/api/auth/status was pre-rendered at build time; it must stay dynamic.");
}

const app = join(here, "server-bundle");
rmSync(app, { recursive: true, force: true });
rmSync(join(here, "migrations"), { recursive: true, force: true });
cpSync(join(build, "standalone"), app, { recursive: true, dereference: true });
mkdirSync(join(app, ".next-desktop"), { recursive: true });
cpSync(join(here, "launcher.js"), join(app, "launcher.js"));
cpSync(join(build, "static"), join(app, ".next-desktop", "static"), { recursive: true });
cpSync(join(root, "public"), join(app, "public"), { recursive: true });
cpSync(join(root, "prisma", "migrations"), join(here, "migrations"), { recursive: true });

// Next copies the project's .env files into a standalone build. They hold this computer's secrets and must never ship.
function removeEnvFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") removeEnvFiles(full);
    } else if (/^\.env(\..*)?$/.test(entry.name)) {
      rmSync(full, { force: true });
      console.log(`Removed ${full.replace(here, "desktop")} from the bundle`);
    }
  }
}
removeEnvFiles(app);
function assertNoEnvFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) assertNoEnvFiles(full);
    else if (/^\.env(\..*)?$/.test(entry.name)) throw new Error(`${full} must not be shipped`);
  }
}
assertNoEnvFiles(app);
console.log("Desktop app files are ready in desktop/server-bundle and desktop/migrations.");
