import { describe, expect, it } from "vitest";
import { createNoteSchema, folderSchema, MAX_NOTE_CONTENT, parseNoteFilters, updateNoteSchema } from "./schemas";

describe("note schemas", () => {
  it("normalizes tags and allows empty drafts", () => {
    expect(createNoteSchema.parse({})).toEqual({});
    expect(createNoteSchema.parse({ tags: ["#Idea", "idea"] }).tags).toEqual(["idea"]);
  });

  it("rejects oversized content and blank folder names", () => {
    expect(() => updateNoteSchema.parse({ content: "x".repeat(MAX_NOTE_CONTENT + 1) })).toThrow();
    expect(() => folderSchema.parse({ name: "   " })).toThrow();
    expect(folderSchema.parse({ name: "  Work  " })).toEqual({ name: "Work" });
  });

  it("reads filters and ignores blanks", () => {
    expect(parseNoteFilters(new URLSearchParams("q=plan&folderId=&tag=work"))).toEqual({ q: "plan", tag: "work" });
  });
});
