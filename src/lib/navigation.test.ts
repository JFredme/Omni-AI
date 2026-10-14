import { describe, expect, it } from "vitest";
import {
  findNavItemForPath,
  getNavItem,
  isActivePath,
  navItems,
  navSections,
} from "@/lib/navigation";

describe("navigation registry", () => {
  it("has unique ids and hrefs", () => {
    const ids = navItems.map((item) => item.id);
    const hrefs = navItems.map((item) => item.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("lists all 13 main navigation destinations", () => {
    expect(navItems).toHaveLength(13);
  });

  it("places every non-settings item in exactly one workspace section", () => {
    const sectionItems = navSections.flatMap((section) => section.items);
    expect(sectionItems).toHaveLength(navItems.length - 1);
    expect(sectionItems.map((item) => item.id)).not.toContain("settings");
  });

  it("marks the built sections as ready in this build", () => {
    const ready = navItems.filter((item) => item.status === "ready").map((item) => item.id);
    expect(ready.sort()).toEqual(["agents", "automations", "calendar", "chat", "home", "knowledge", "notes", "projects", "research", "settings", "tasks"]);
  });

  it("throws for unknown ids", () => {
    expect(() => getNavItem("missing")).toThrow("Unknown navigation item: missing");
  });
});

describe("isActivePath", () => {
  it("matches the home route only exactly", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/tasks", "/")).toBe(false);
  });

  it("matches nested routes under a section", () => {
    expect(isActivePath("/tasks/42", "/tasks")).toBe(true);
    expect(isActivePath("/tasksx", "/tasks")).toBe(false);
  });

  it("finds the navigation item for a path", () => {
    expect(findNavItemForPath("/settings")?.id).toBe("settings");
    expect(findNavItemForPath("/notes/abc")?.id).toBe("notes");
    expect(findNavItemForPath("/unknown")).toBeUndefined();
  });
});
