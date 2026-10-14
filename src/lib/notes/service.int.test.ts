// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  getNote,
  getNotesMeta,
  listNotes,
  renameFolder,
  updateNote,
} from "./service";

beforeEach(async () => {
  assertTestDatabase();
  await prisma.note.deleteMany();
  await prisma.noteFolder.deleteMany();
});

describe("note service (database)", () => {
  it("creates, updates, and deletes a note", async () => {
    const note = await createNote({ title: "  Ideas ", content: "# Hello" });
    expect(note.title).toBe("Ideas");
    const updated = await updateNote(note.id, { content: "# Changed", tags: ["a"], pinned: true });
    expect(updated).toMatchObject({ content: "# Changed", tags: ["a"], pinned: true });
    await deleteNote(note.id);
    await expect(getNote(note.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateNote(note.id, { title: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteNote(note.id)).rejects.toMatchObject({ status: 404 });
  });

  it("lists pinned notes first, then most recently updated", async () => {
    const a = await createNote({ title: "A" });
    await createNote({ title: "B" });
    const c = await createNote({ title: "C" });
    await updateNote(a.id, { pinned: true });
    await updateNote(c.id, { content: "touched" });
    expect((await listNotes()).map((note) => note.title)).toEqual(["A", "C", "B"]);
  });

  it("searches title, body, and tags, and filters by folder and tag", async () => {
    const folder = await createFolder("Work");
    await createNote({ title: "Standup", content: "Discuss the roadmap", folderId: folder.id, tags: ["meeting"] });
    await createNote({ title: "Groceries", content: "milk and eggs" });

    const titles = async (filters: Parameters<typeof listNotes>[0]) => (await listNotes(filters)).map((note) => note.title);
    expect(await titles({ q: "ROADMAP" })).toEqual(["Standup"]);
    expect(await titles({ q: "groc" })).toEqual(["Groceries"]);
    expect(await titles({ q: "meeting" })).toEqual(["Standup"]);
    expect(await titles({ folderId: folder.id })).toEqual(["Standup"]);
    expect(await titles({ folderId: "none" })).toEqual(["Groceries"]);
    expect(await titles({ tag: "meeting" })).toEqual(["Standup"]);
  });

  it("returns excerpts in the list but full content only for a single note", async () => {
    const note = await createNote({ content: "# Heading\n\nBody text" });
    const [summary] = await listNotes();
    expect(summary).not.toHaveProperty("content");
    expect(summary.excerpt).toBe("Heading Body text");
    expect((await getNote(note.id)).content).toBe("# Heading\n\nBody text");
  });

  it("manages folders: unique names, rename, and delete keeps the notes", async () => {
    const folder = await createFolder("Ideas");
    await expect(createFolder("ideas")).rejects.toMatchObject({ code: "folder_exists" });
    const other = await createFolder("Other");
    await expect(renameFolder(other.id, "IDEAS")).rejects.toMatchObject({ code: "folder_exists" });
    expect((await renameFolder(folder.id, "Ideas 2")).name).toBe("Ideas 2");

    const note = await createNote({ title: "Kept", folderId: folder.id });
    await deleteFolder(folder.id);
    expect((await getNote(note.id)).folderId).toBeNull();
    await expect(deleteFolder(folder.id)).rejects.toMatchObject({ status: 404 });
    await expect(createNote({ folderId: folder.id })).rejects.toMatchObject({ code: "folder_not_found" });
  });

  it("summarizes folders, tags, and counts", async () => {
    const folder = await createFolder("Work");
    await createNote({ folderId: folder.id, tags: ["x", "y"] });
    await createNote({ tags: ["x"] });
    expect(await getNotesMeta()).toEqual({
      folders: [{ id: folder.id, name: "Work", noteCount: 1 }],
      tags: [
        { tag: "x", count: 2 },
        { tag: "y", count: 1 },
      ],
      total: 2,
      unfiled: 1,
    });
  });
});
