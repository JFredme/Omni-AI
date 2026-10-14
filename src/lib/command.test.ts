import { describe, expect, it } from "vitest";
import { filterCommands, type CommandEntry } from "@/lib/command";

const entries: CommandEntry[] = [
  { id: "a", label: "Use dark theme", group: "Appearance", keywords: "night" },
  { id: "b", label: "Use light theme", group: "Appearance" },
  { id: "c", label: "Settings", group: "Go to", keywords: "preferences shortcuts" },
];

describe("filterCommands", () => {
  it("returns every entry for an empty or whitespace query", () => {
    expect(filterCommands(entries, "")).toHaveLength(3);
    expect(filterCommands(entries, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively on the label", () => {
    expect(filterCommands(entries, "SETTINGS").map((entry) => entry.id)).toEqual(["c"]);
  });

  it("requires every word to match", () => {
    expect(filterCommands(entries, "use dark").map((entry) => entry.id)).toEqual(["a"]);
    expect(filterCommands(entries, "use purple")).toEqual([]);
  });

  it("matches on group and keywords", () => {
    expect(filterCommands(entries, "appearance").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(filterCommands(entries, "preferences").map((entry) => entry.id)).toEqual(["c"]);
    expect(filterCommands(entries, "night").map((entry) => entry.id)).toEqual(["a"]);
  });
});
