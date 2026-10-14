import { describe, expect, it } from "vitest";
import {
  MAX_NEW_FOLDERS,
  MAX_PLAN_TASKS,
  sanitizeOrganizeNotes,
  sanitizeOrganizeTasks,
  sanitizePlan,
  sanitizePriorities,
  sanitizeSummary,
  toPriority,
} from "./sanitize";

describe("sanitizePlan", () => {
  const context = { mode: "plan" as const, existingTaskTitles: ["Set up repo"], existingMilestoneTitles: ["Kickoff"] };

  it("cleans fields, clamps enums, and validates dates", () => {
    const plan = sanitizePlan(
      {
        summary: "  Ship in phases ",
        milestones: [{ title: " Beta ", dueDate: "2026-08-01" }, { title: "Launch", dueDate: "soon" }],
        tasks: [
          { title: " Write spec ", priority: "CRITICAL", dueDate: "2026-02-30", milestone: "beta", tags: ["#Docs", "docs"], subtasks: ["Outline", "outline", ""] },
          { title: "Do thing", priority: "High", milestone: "Kickoff" },
        ],
      },
      context,
    );
    expect(plan.summary).toBe("Ship in phases");
    expect(plan.milestones).toEqual([
      { title: "Beta", dueDate: "2026-08-01" },
      { title: "Launch", dueDate: null },
    ]);
    expect(plan.tasks[0]).toMatchObject({ title: "Write spec", priority: "medium", dueDate: null, milestone: "Beta", tags: ["docs"], subtasks: ["Outline"] });
    expect(plan.tasks[1]).toMatchObject({ priority: "high", milestone: "Kickoff" });
  });

  it("drops duplicates of existing and earlier tasks, unknown milestone references, and existing milestones", () => {
    const plan = sanitizePlan(
      {
        milestones: [{ title: "kickoff" }, { title: "Beta" }, { title: "BETA" }],
        tasks: [{ title: "set up repo" }, { title: "A", milestone: "Imaginary" }, { title: "a" }, { title: "  " }],
      },
      context,
    );
    expect(plan.milestones.map((milestone) => milestone.title)).toEqual(["Beta"]);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].milestone).toBeNull();
  });

  it("ignores milestones in tasks mode but still links to existing ones", () => {
    const plan = sanitizePlan(
      { milestones: [{ title: "New" }], tasks: [{ title: "T", milestone: "kickoff" }] },
      { ...context, mode: "tasks" },
    );
    expect(plan.milestones).toEqual([]);
    expect(plan.tasks[0].milestone).toBe("Kickoff");
  });

  it("caps the number of tasks", () => {
    const tasks = Array.from({ length: 100 }, (_, index) => ({ title: `Task ${index}` }));
    expect(sanitizePlan({ tasks }, context).tasks).toHaveLength(MAX_PLAN_TASKS);
  });

  it("copes with missing arrays", () => {
    expect(sanitizePlan({}, context)).toEqual({ summary: "", milestones: [], tasks: [] });
  });
});

describe("sanitizeSummary", () => {
  it("trims, limits, and normalizes", () => {
    const result = sanitizeSummary({ summary: "  Short.  ", keyPoints: ["a", " ", "b"], suggestedTags: ["#One", "one", "Two Words"] });
    expect(result).toEqual({ summary: "Short.", keyPoints: ["a", "b"], suggestedTags: ["one", "two-words"] });
  });
});

describe("sanitizePriorities", () => {
  const tasks = [
    { id: "t1", title: "One", priority: "low" as const },
    { id: "t2", title: "Two", priority: "high" as const },
  ];

  it("keeps real, changed, valid suggestions only, once per task", () => {
    const result = sanitizePriorities(
      {
        summary: "ok",
        suggestions: [
          { taskId: "t1", priority: "urgent", reason: "Due tomorrow" },
          { taskId: "t1", priority: "high" },
          { taskId: "t2", priority: "high" },
          { taskId: "ghost", priority: "low" },
          { taskId: "t2", priority: "nonsense" },
        ],
      },
      tasks,
    );
    expect(result.suggestions).toEqual([{ taskId: "t1", title: "One", current: "low", suggested: "urgent", reason: "Due tomorrow" }]);
  });

  it("parses priorities case-insensitively", () => {
    expect(toPriority(" URGENT ")).toBe("urgent");
    expect(toPriority("p1")).toBeNull();
    expect(toPriority(null)).toBeNull();
  });
});

describe("sanitizeOrganizeTasks", () => {
  const tasks = [
    { id: "t1", title: "Buy domain", projectId: null, tags: ["web"] },
    { id: "t2", title: "Fix bug", projectId: "p1", tags: [] },
  ];
  const projects = [
    { id: "p1", name: "App" },
    { id: "p2", name: "Website" },
  ];

  it("accepts only known projects and drops no-op suggestions", () => {
    const result = sanitizeOrganizeTasks(
      {
        suggestions: [
          { taskId: "t1", projectId: "p2", addTags: ["Web", "domain"], reason: "Site work" },
          { taskId: "t2", projectId: "p1", addTags: [] },
          { taskId: "t2", projectId: "made-up", addTags: [] },
          { taskId: "ghost", projectId: "p1" },
        ],
      },
      tasks,
      projects,
    );
    expect(result.suggestions).toEqual([
      { taskId: "t1", title: "Buy domain", projectId: "p2", projectName: "Website", addTags: ["domain"], reason: "Site work" },
    ]);
  });

  it("keeps a tags-only suggestion without a project change", () => {
    const result = sanitizeOrganizeTasks({ suggestions: [{ taskId: "t2", projectId: null, addTags: ["urgent"] }] }, tasks, projects);
    expect(result.suggestions[0]).toMatchObject({ projectId: null, projectName: null, addTags: ["urgent"] });
  });
});

describe("sanitizeOrganizeNotes", () => {
  const notes = [
    { id: "n1", title: "Standup", folderId: "f1", tags: [] },
    { id: "n2", title: "Recipe", folderId: null, tags: ["food"] },
  ];
  const folders = [{ id: "f1", name: "Work" }];

  it("matches existing folders case-insensitively and flags new ones", () => {
    const result = sanitizeOrganizeNotes(
      {
        suggestions: [
          { noteId: "n1", folder: "work", addTags: [] },
          { noteId: "n2", folder: "Cooking", addTags: ["food", "dinner"] },
        ],
      },
      notes,
      folders,
    );
    expect(result.suggestions).toEqual([
      { noteId: "n2", title: "Recipe", folder: "Cooking", newFolder: true, addTags: ["dinner"], reason: "" },
    ]);
  });

  it("reuses a proposed new folder and limits how many are created", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, title: `N${index}`, folderId: null, tags: [] }));
    const result = sanitizeOrganizeNotes(
      { suggestions: many.map((note, index) => ({ noteId: note.id, folder: `Folder ${index}`, addTags: [] })) },
      many,
      [],
    );
    expect(new Set(result.suggestions.map((suggestion) => suggestion.folder)).size).toBe(MAX_NEW_FOLDERS);

    const same = sanitizeOrganizeNotes(
      { suggestions: [{ noteId: "n0", folder: "Ideas" }, { noteId: "n1", folder: "ideas" }] },
      many,
      [],
    );
    expect(same.suggestions.map((suggestion) => suggestion.folder)).toEqual(["Ideas", "Ideas"]);
  });
});
