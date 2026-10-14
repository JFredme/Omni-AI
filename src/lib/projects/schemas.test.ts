import { describe, expect, it } from "vitest";
import { createMilestoneSchema, createProjectSchema, updateMilestoneSchema, updateProjectSchema } from "./schemas";

describe("project schemas", () => {
  it("requires a name and a valid status", () => {
    expect(() => createProjectSchema.parse({ name: "  " })).toThrow();
    expect(() => createProjectSchema.parse({ name: "x", status: "finished" })).toThrow();
    expect(createProjectSchema.parse({ name: " Launch ", status: "active" })).toEqual({ name: "Launch", status: "active" });
  });

  it("validates due dates and lets them be cleared", () => {
    expect(() => updateProjectSchema.parse({ dueDate: "next week" })).toThrow();
    expect(updateProjectSchema.parse({ dueDate: null })).toEqual({ dueDate: null });
  });

  it("validates milestones", () => {
    expect(() => createMilestoneSchema.parse({ title: "" })).toThrow();
    expect(updateMilestoneSchema.parse({ completed: true })).toEqual({ completed: true });
  });
});
