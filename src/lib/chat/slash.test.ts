import { describe, expect, it } from "vitest";
import { matchSlash, parseSlash, SLASH_COMMANDS } from "./slash";

describe("slash commands", () => {
  it("has unique names, and every command either goes somewhere or needs text or is an action like new chat or voice", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of SLASH_COMMANDS) expect(Boolean(command.href) || Boolean(command.argument) || command.name === "new" || command.name === "voice", command.name).toBe(true);
  });

  it("suggests commands while the name is being typed, and stops once there's a space", () => {
    expect(matchSlash("/")?.length).toBe(SLASH_COMMANDS.length);
    expect(matchSlash("/ta")?.map((command) => command.name)).toEqual(["task", "tasks"]);
    expect(matchSlash("/TASK")?.map((command) => command.name)).toEqual(["task", "tasks"]);
    expect(matchSlash("/task buy milk")).toBeNull();
    expect(matchSlash("hello /task")).toBeNull();
    expect(matchSlash("/zzz")).toBeNull();
  });

  it("reads a finished command and its text", () => {
    expect(parseSlash("/task Buy milk")).toMatchObject({ command: { name: "task" }, text: "Buy milk" });
    expect(parseSlash("  /note   a\nb  ")).toMatchObject({ command: { name: "note" }, text: "a\nb" });
    expect(parseSlash("/tasks")).toMatchObject({ command: { name: "tasks" }, text: "" });
    expect(parseSlash("/new")).toMatchObject({ command: { name: "new" } });
  });

  it("leaves ordinary messages alone: unknown commands, missing text, and slashes mid-sentence", () => {
    expect(parseSlash("/task")).toBeNull(); // needs something to add
    expect(parseSlash("/unknown thing")).toBeNull();
    expect(parseSlash("what is 1/2?")).toBeNull();
    expect(parseSlash("/etc/passwd explain this")).toBeNull();
  });
});
