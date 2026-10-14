import { spawn, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { languageFor, pathProblem } from "./paths";

/**
 * Runs code the user (or an AI suggestion the user chose to run) wrote. It only ever runs inside a Docker container with
 * no network, no extra privileges, a read-only file system, and hard limits on memory, processes, time, and output.
 * If Docker isn't available, nothing runs: there is deliberately no fallback to running on this machine.
 */

export interface SandboxConfig {
  dockerBin: string;
  nodeImage: string;
  pythonImage: string;
  timeoutMs: number;
  maxOutputBytes: number;
  memory: string;
}

export function sandboxConfig(): SandboxConfig {
  return {
    dockerBin: process.env.CODE_DOCKER_BIN || "docker",
    nodeImage: process.env.CODE_SANDBOX_NODE_IMAGE || "node:22-alpine",
    pythonImage: process.env.CODE_SANDBOX_PYTHON_IMAGE || "python:3.12-alpine",
    timeoutMs: Number(process.env.CODE_RUN_TIMEOUT_MS) || 15_000,
    maxOutputBytes: 64 * 1024,
    memory: "256m",
  };
}

/** An environment with only what the docker program needs, so none of this app's secrets can reach it. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }

  return env as NodeJS.ProcessEnv;
}

export function dockerRunArgs(input: { name: string; hostDir: string; image: string; command: string[]; config: SandboxConfig }): string[] {
  return [
    "run",
    "--rm",
    "--name", input.name,
    "--network", "none",
    "--memory", input.config.memory,
    "--memory-swap", input.config.memory,
    "--cpus", "1",
    "--pids-limit", "64",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--user", "65534:65534",
    "--env", "HOME=/tmp",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    "--env", "PYTHONUNBUFFERED=1",
    "--volume", `${input.hostDir}:/work:ro`,
    "--workdir", "/work",
    input.image,
    ...input.command,
  ];
}

export interface Spawner {
  (command: string, args: string[], options: SpawnOptions): ReturnType<typeof spawn>;
}
export const deps: { spawn: Spawner } = { spawn: (command, args, options) => spawn(command, args, options) };

let cached: { at: number; value: SandboxStatus } | null = null;
export interface SandboxStatus {
  available: boolean;
  reason: string | null;
}

/** Whether Docker can be reached. Cached briefly so the editor can ask often. */
export async function sandboxStatus(config: SandboxConfig = sandboxConfig(), now = Date.now()): Promise<SandboxStatus> {
  if (cached && now - cached.at < 20_000) return cached.value;
  const value = await new Promise<SandboxStatus>((resolve) => {
    let finished = false;
    const done = (status: SandboxStatus) => {
      if (!finished) {
        finished = true;
        resolve(status);
      }
    };
    try {
      const child = deps.spawn(config.dockerBin, ["version", "--format", "{{.Server.Version}}"], { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done({ available: false, reason: "Docker didn't answer in time." });
      }, 5_000);
      child.on("error", () => {
        clearTimeout(timer);
        done({ available: false, reason: "Docker isn't installed, so code can't be run safely. Install Docker and restart Omni to enable Run." });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(code === 0 ? { available: true, reason: null } : { available: false, reason: "Docker is installed but isn't running. Start Docker and try again." });
      });
    } catch {
      done({ available: false, reason: "Docker isn't installed, so code can't be run safely. Install Docker and restart Omni to enable Run." });
    }
  });
  cached = { at: now, value };
  return value;
}

export function resetSandboxStatusCache() {
  cached = null;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export class SandboxError extends Error {
  constructor(
    message: string,
    /** "unavailable": Docker can't be used right now. "invalid": the request itself can't be run. */
    readonly kind: "unavailable" | "invalid" = "invalid",
  ) {
    super(message);
  }
}

/** Writes the project's files to a throwaway folder, runs the entry file in a locked-down container, and cleans up. */
export async function runInSandbox(input: { files: { path: string; content: string }[]; entry: string; signal?: AbortSignal; config?: SandboxConfig }): Promise<RunResult> {
  const config = input.config ?? sandboxConfig();
  const problem = pathProblem(input.entry);
  if (problem) throw new SandboxError(problem);
  const runtime = languageFor(input.entry).run;
  if (!runtime) throw new SandboxError("Only JavaScript (.js, .mjs, .cjs) and Python (.py) files can be run.");
  const status = await sandboxStatus(config);
  if (!status.available) throw new SandboxError(status.reason ?? "Docker isn't available.", "unavailable");

  const hostDir = await mkdtemp(path.join(tmpdir(), "omni-run-"));
  const name = `omni-run-${randomBytes(6).toString("hex")}`;
  try {
    for (const file of input.files) {
      if (pathProblem(file.path)) continue;
      const target = path.join(hostDir, file.path);
      // Belt and braces: the path was validated, but never write outside the folder.
      if (!target.startsWith(hostDir + path.sep)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    const image = runtime === "node" ? config.nodeImage : config.pythonImage;
    const command = runtime === "node" ? ["node", input.entry] : ["python", "-I", input.entry];
    const args = dockerRunArgs({ name, hostDir, image, command, config });

    const started = Date.now();
    return await new Promise<RunResult>((resolve, reject) => {
      const child = deps.spawn(config.dockerBin, args, { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;
      let settled = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const take = (current: string, chunk: Buffer) => {
        if (current.length >= config.maxOutputBytes) {
          truncated = true;
          return current;
        }
        const next = current + chunk.toString("utf8");
        if (next.length > config.maxOutputBytes) {
          truncated = true;
          return next.slice(0, config.maxOutputBytes);
        }
        return next;
      };
      child.stdout?.on("data", (chunk: Buffer) => (stdout = take(stdout, chunk)));
      child.stderr?.on("data", (chunk: Buffer) => (stderr = take(stderr, chunk)));

      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        input.signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode: timedOut ? null : code, stdout, stderr, timedOut, truncated, durationMs: Date.now() - started });
      };
      const stop = () => {
        // Killing the docker client isn't enough to stop the container, so ask Docker to kill it by name.
        deps.spawn(config.dockerBin, ["kill", name], { env: cleanEnv(), stdio: "ignore" }).on("error", () => undefined);
        child.kill("SIGKILL");
        // If something is still holding the output open, don't wait for it forever.
        forceTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(null);
        }, 1_000);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, config.timeoutMs);
      const onAbort = () => stop();
      input.signal?.addEventListener("abort", onAbort, { once: true });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        input.signal?.removeEventListener("abort", onAbort);
        reject(new SandboxError(`Docker couldn't start the program: ${error.message}`, "unavailable"));
      });
      child.on("close", (code) => finish(code));
    });
  } finally {
    await rm(hostDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
