// @vitest-environment node
import { chmod, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dockerRunArgs, resetSandboxStatusCache, runInSandbox, sandboxConfig, sandboxStatus, type SandboxConfig } from "./sandbox";

let dir: string;
let log: string;
const base = (over: Partial<SandboxConfig> = {}): SandboxConfig => ({ ...sandboxConfig(), dockerBin: path.join(dir, "docker"), timeoutMs: 3_000, ...over });

/** A stand-in for the docker program that records how it was called, so the arguments can be checked without Docker. */
async function fakeDocker(body: string) {
  const script = `#!/bin/sh\necho "$@" >> "${log}"\n${body}\n`;
  await writeFile(path.join(dir, "docker"), script);
  await chmod(path.join(dir, "docker"), 0o755);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fake-docker-"));
  log = path.join(dir, "calls.log");
  resetSandboxStatusCache();
});
afterEach(() => resetSandboxStatusCache());

describe("dockerRunArgs", () => {
  const args = dockerRunArgs({ name: "n", hostDir: "/tmp/x", image: "node:22-alpine", command: ["node", "main.js"], config: sandboxConfig() });
  const has = (...parts: string[]) => expect(args.join(" ")).toContain(parts.join(" "));

  it("removes the network, privileges, and write access, and limits memory, processes, and CPU", () => {
    has("--network none");
    has("--cap-drop ALL");
    has("--security-opt no-new-privileges");
    has("--read-only");
    has("--user 65534:65534");
    has("--memory 256m");
    has("--memory-swap 256m");
    has("--pids-limit 64");
    has("--cpus 1");
    has("--volume /tmp/x:/work:ro");
    expect(args.slice(-3)).toEqual(["node:22-alpine", "node", "main.js"]);
  });

  it("never mounts anything but the run folder, shares no host namespaces, and isn't privileged", () => {
    const text = args.join(" ");
    expect(text).not.toMatch(/--privileged|--pid[ =]|--ipc|--uts|--network host|docker\.sock|--device|-v \//);
    expect(args.filter((a) => a === "--volume")).toHaveLength(1);
  });
});

describe("sandboxStatus", () => {
  it("says so plainly when Docker isn't installed", async () => {
    const status = await sandboxStatus({ ...sandboxConfig(), dockerBin: "/definitely/not/docker" }, 1);
    expect(status).toMatchObject({ available: false });
    expect(status.reason).toMatch(/isn't installed/);
  });

  it("says when Docker is installed but not running, and when it works", async () => {
    await fakeDocker("exit 1");
    expect((await sandboxStatus(base(), 1)).reason).toMatch(/isn't running/);
    resetSandboxStatusCache();
    await fakeDocker("echo 27.0.1");
    expect(await sandboxStatus(base(), 1)).toEqual({ available: true, reason: null });
  });
});

describe("runInSandbox", () => {
  it("refuses to run when Docker is missing, and never falls back to this machine", async () => {
    await expect(runInSandbox({ files: [{ path: "a.js", content: "console.log(1)" }], entry: "a.js", config: { ...sandboxConfig(), dockerBin: "/definitely/not/docker" } })).rejects.toThrow(/isn't installed/);
  });

  it("checks the file before anything else", async () => {
    await expect(runInSandbox({ files: [], entry: "../evil.js", config: base() })).rejects.toMatchObject({ kind: "invalid" });
    await expect(runInSandbox({ files: [], entry: "notes.md", config: base() })).rejects.toThrow(/Only JavaScript/);
    await expect(runInSandbox({ files: [{ path: "a.js", content: "" }], entry: "a.js", config: { ...sandboxConfig(), dockerBin: "/definitely/not/docker" } })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("runs the entry file with the locked-down arguments, copies only valid files, and cleans up", async () => {
    await fakeDocker(`case "$1" in version) echo 27;; run) echo "hello from the container"; echo "oops" >&2; exit 3;; esac`);
    const before = (await readdir(tmpdir())).filter((n) => n.startsWith("omni-run-")).length;
    const result = await runInSandbox({
      files: [
        { path: "main.py", content: "print('hi')" },
        { path: "lib/util.py", content: "x = 1" },
        { path: "../escape.py", content: "bad" },
        { path: "/abs.py", content: "bad" },
      ],
      entry: "main.py",
      config: base(),
    });
    expect(result).toMatchObject({ exitCode: 3, stdout: "hello from the container\n", stderr: "oops\n", timedOut: false, truncated: false });
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    const runCall = calls.find((c) => c.startsWith("run "))!;
    expect(runCall).toContain("--network none");
    expect(runCall).toContain("python:3.12-alpine python -I main.py");
    expect((await readdir(tmpdir())).filter((n) => n.startsWith("omni-run-")).length).toBe(before);
  });

  it("stops a program that runs too long, kills the container by name, and says it timed out", async () => {
    await fakeDocker(`case "$1" in version) echo 27;; run) sleep 30;; kill) echo killed >> "${log}.kill";; esac`);
    const result = await runInSandbox({ files: [{ path: "loop.js", content: "while(true){}" }], entry: "loop.js", config: base({ timeoutMs: 400 }) });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(5_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await readFile(`${log}.kill`, "utf8")).trim()).toBe("killed");
    expect((await readFile(log, "utf8")).split("\n").some((l) => /^kill omni-run-[0-9a-f]+$/.test(l))).toBe(true);
  });

  it("cuts off a flood of output", async () => {
    await fakeDocker(`case "$1" in version) echo 27;; run) yes "spam spam spam spam" | head -c 2000000;; esac`);
    const result = await runInSandbox({ files: [{ path: "a.js", content: "" }], entry: "a.js", config: base({ maxOutputBytes: 1_000 }) });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1_000);
  });

  it("can be cancelled", async () => {
    await fakeDocker(`case "$1" in version) echo 27;; run) sleep 30;; kill) :;; esac`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await runInSandbox({ files: [{ path: "a.js", content: "" }], entry: "a.js", signal: controller.signal, config: base({ timeoutMs: 10_000 }) });
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it("doesn't pass this app's secrets to the docker program", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret-password@host/db";
    process.env.ENCRYPTION_KEY = "super-secret-encryption-key-123456";
    try {
      await fakeDocker(`case "$1" in version) env > "${log}.env"; echo 27;; run) env >> "${log}.env";; esac`);
      await runInSandbox({ files: [{ path: "a.js", content: "" }], entry: "a.js", config: base() });
      const env = await readFile(`${log}.env`, "utf8");
      expect(env).not.toContain("secret-password");
      expect(env).not.toContain("super-secret-encryption-key");
      expect(env).not.toContain("DATABASE_URL");
    } finally {
      delete process.env.DATABASE_URL;
      delete process.env.ENCRYPTION_KEY;
    }
  });
});
