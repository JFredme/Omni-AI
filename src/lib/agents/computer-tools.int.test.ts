// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { getTool, TOOLS } from "./tools";

const context = { runId: "r", depth: 0 };
const run = (name: string, args: unknown) => getTool(name)!.run(args as never, context) as Promise<Record<string, unknown>>;

async function setComputerControl(on: boolean) {
  await prisma.appSettings.deleteMany();
  await prisma.appSettings.create({ data: { id: 1, computerControl: on } });
}

beforeEach(async () => {
  assertTestDatabase();
  await setComputerControl(false);
});

describe("computer tools (database)", () => {
  it("are all marked as using the computer, so every use asks first", () => {
    const names = ["run_command", "list_folder", "read_file", "write_file", "open_item"];
    for (const name of names) expect(getTool(name)?.risk).toBe("computer");
    expect(TOOLS.filter((tool) => tool.risk === "computer").map((tool) => tool.name).sort()).toEqual([...names].sort());
  });

  it("refuse to do anything while the setting is off", async () => {
    await expect(run("run_command", { command: "echo hi" })).rejects.toThrow(/turned off/);
    await expect(run("read_file", { path: "/etc/hosts" })).rejects.toThrow(/turned off/);
    await expect(run("write_file", { path: path.join(os.tmpdir(), "omni-off.txt"), content: "x" })).rejects.toThrow(/turned off/);
  });

  it("run commands, write and read files, and list folders once allowed", async () => {
    await setComputerControl(true);
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "omni-computer-"));
    try {
      const out = await run("run_command", { command: "echo hello-from-omni", folder });
      expect(out.exitCode).toBe(0);
      expect(String(out.stdout)).toContain("hello-from-omni");

      await run("write_file", { path: path.join(folder, "notes", "a.txt"), content: "first line\nsecond" });
      const read = await run("read_file", { path: path.join(folder, "notes", "a.txt") });
      expect(read.text).toBe("first line\nsecond");
      const listed = await run("list_folder", { path: folder });
      expect(listed.entries).toEqual(["notes/"]);

      const failed = await run("run_command", { command: "exit 3", folder });
      expect(failed.exitCode).toBe(3);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("still refuse dangerous commands and secret files when allowed", async () => {
    await setComputerControl(true);
    await expect(run("run_command", { command: "sudo ls" })).rejects.toThrow(/administrator/);
    await expect(run("run_command", { command: "cat ~/.ssh/id_rsa" })).rejects.toThrow(/Secret files/);
    await expect(run("read_file", { path: "~/.ssh/id_rsa" })).rejects.toThrow(/off limits/);
    await expect(run("write_file", { path: "~/project/.env", content: "X=1" })).rejects.toThrow(/off limits/);
  });

  it("do not hand OMNI's own secrets to commands", async () => {
    await setComputerControl(true);
    process.env.OPENROUTER_API_KEY = "sk-secret-should-not-leak";
    const out = await run("run_command", { command: "env" });
    expect(String(out.stdout)).not.toContain("sk-secret-should-not-leak");
    expect(String(out.stdout)).not.toContain("DATABASE_URL");
    delete process.env.OPENROUTER_API_KEY;
  });
});
