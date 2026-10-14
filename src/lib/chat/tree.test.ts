import { describe, expect, it } from "vitest";
import { activePath, deepestLatest, pathTo, siblingsOf } from "./tree";

// u1 -> a1 -> u2 -> a2
//          \-> u2b -> a2b      (u2b is an edit of u2)
//  u1 -> a1b                   (a1b is a regenerated a1)
const nodes = [
  { id: "u1", parentId: null, createdAt: 1 },
  { id: "a1", parentId: "u1", createdAt: 2 },
  { id: "u2", parentId: "a1", createdAt: 3 },
  { id: "a2", parentId: "u2", createdAt: 4 },
  { id: "u2b", parentId: "a1", createdAt: 5 },
  { id: "a2b", parentId: "u2b", createdAt: 6 },
  { id: "a1b", parentId: "u1", createdAt: 7 },
];

describe("message tree", () => {
  it("walks from the root to a leaf", () => {
    expect(pathTo(nodes, "a2").map((n) => n.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(pathTo(nodes, "a2b").map((n) => n.id)).toEqual(["u1", "a1", "u2b", "a2b"]);
    expect(pathTo(nodes, null)).toEqual([]);
    expect(pathTo(nodes, "missing")).toEqual([]);
  });

  it("shows the saved leaf's path, or the newest message's when none is saved", () => {
    expect(activePath(nodes, "a2").map((n) => n.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(activePath(nodes, null).map((n) => n.id)).toEqual(["u1", "a1b"]);
    expect(activePath(nodes, "gone").map((n) => n.id)).toEqual(["u1", "a1b"]);
    expect(activePath([], null)).toEqual([]);
  });

  it("lists alternatives in the order they were made", () => {
    expect(siblingsOf(nodes, nodes[2]).map((n) => n.id)).toEqual(["u2", "u2b"]);
    expect(siblingsOf(nodes, nodes[1]).map((n) => n.id)).toEqual(["a1", "a1b"]);
    expect(siblingsOf(nodes, nodes[0]).map((n) => n.id)).toEqual(["u1"]);
  });

  it("follows the newest reply down to the end of a branch", () => {
    expect(deepestLatest(nodes, "u2")).toBe("a2");
    expect(deepestLatest(nodes, "a1")).toBe("a2b");
    expect(deepestLatest(nodes, "a1b")).toBe("a1b");
  });

  it("survives corrupt data that loops", () => {
    const loop = [
      { id: "x", parentId: "y", createdAt: 1 },
      { id: "y", parentId: "x", createdAt: 2 },
    ];
    expect(pathTo(loop, "x").length).toBeLessThanOrEqual(2);
    expect(deepestLatest(loop, "x")).toBeTruthy();
  });
});
