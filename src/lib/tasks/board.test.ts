import { describe, expect, it } from "vitest";
import { endPosition, planDrop, sortByPosition } from "./board";

const card = (id: string, position: number) => ({ id, position, createdAt: "2026-01-01T00:00:00Z" });
const column = [card("a", 10), card("b", 20), card("c", 30)];

describe("board ordering", () => {
  it("sorts by position, then creation time, then id", () => {
    const sorted = sortByPosition([card("z", 5), { ...card("y", 5), createdAt: "2025-01-01T00:00:00Z" }, card("x", 1)]);
    expect(sorted.map((task) => task.id)).toEqual(["x", "y", "z"]);
  });

  it("drops between two cards", () => {
    expect(planDrop(column, "x", 1)).toEqual({ position: 15, unchanged: false });
  });

  it("drops at the top and the bottom of a column", () => {
    expect(planDrop(column, "x", 0).position).toBeLessThan(10);
    expect(planDrop(column, "x", 3).position).toBeGreaterThan(30);
  });

  it("drops into an empty column", () => {
    expect(planDrop([], "x", 0).unchanged).toBe(false);
    expect(Number.isFinite(planDrop([], "x", 0).position)).toBe(true);
  });

  it("moving a card down accounts for its own slot", () => {
    // Dragging "a" into the gap after "b" (index 2 in the full list) puts it between b and c.
    expect(planDrop(column, "a", 2)).toEqual({ position: 25, unchanged: false });
  });

  it("moving a card up lands before the target", () => {
    expect(planDrop(column, "c", 1)).toEqual({ position: 15, unchanged: false });
  });

  it("detects a drop that leaves the card where it is", () => {
    expect(planDrop(column, "b", 1).unchanged).toBe(true);
    expect(planDrop(column, "b", 2).unchanged).toBe(true);
    expect(planDrop(column, "a", 0).unchanged).toBe(true);
  });

  it("finds the end of a column", () => {
    expect(endPosition(column)).toBeGreaterThan(30);
    expect(Number.isFinite(endPosition([]))).toBe(true);
  });
});
