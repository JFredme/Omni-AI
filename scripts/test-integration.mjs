// Applies migrations to the test database, then runs the database-backed test suite.
import { spawnSync } from "node:child_process";

const testUrl = process.env.TEST_DATABASE_URL ?? "postgresql://joshy@localhost:5432/omni_ai_test";
const env = { ...process.env, DATABASE_URL: testUrl };

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["vitest", "run", "-c", "vitest.integration.config.mts"]);
