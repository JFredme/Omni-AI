import { describe, expect, it } from "vitest";
import { createTaskSchema, parseTaskFilters, updateTaskSchema } from "./schemas";
import { subtaskProgress, type TaskDto } from "./types";

describe("task schemas", () => {
  it("trims the title and normalizes tags", () => {
    const parsed = createTaskSchema.parse({ title: "  Write report ", tags: ["#Work", "work", "Deep Focus"] });
    expect(parsed.title).toBe("Write report");
    expect(parsed.tags).toEqual(["work", "deep-focus"]);
  });

  it("rejects blank titles, bad priorities, and impossible dates", () => {
    expect(() => createTaskSchema.parse({ title: "   " })).toThrow();
    expect(() => createTaskSchema.parse({ title: "x", priority: "critical" })).toThrow();
    expect(() => createTaskSchema.parse({ title: "x", dueDate: "2026-02-30" })).toThrow();
    expect(() => updateTaskSchema.parse({ position: Number.NaN })).toThrow();
  });

  it("allows clearing the due date", () => {
    expect(updateTaskSchema.parse({ dueDate: null })).toEqual({ dueDate: null });
  });

  it("reads filters from a query string and ignores blanks", () => {
    const filters = parseTaskFilters(new URLSearchParams("q=plan&status=todo&priority=&sort=due"));
    expect(filters).toEqual({ q: "plan", status: "todo", sort: "due" });
    expect(() => parseTaskFilters(new URLSearchParams("sort=random"))).toThrow();
  });

  it("counts finished subtasks", () => {
    const subtasks = [{ status: "done" }, { status: "todo" }, { status: "done" }] as TaskDto[];
    expect(subtaskProgress({ subtasks })).toEqual({ done: 2, total: 3 });
  });
});
