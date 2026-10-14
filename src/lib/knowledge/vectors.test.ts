import { describe, expect, it } from "vitest";
import { dot, fromBytes, normalize, toBytes, topK } from "./vectors";

describe("vectors", () => {
  it("normalizes to unit length and survives a byte round trip", () => {
    const unit = normalize([3, 4]);
    expect(dot(unit, unit)).toBeCloseTo(1, 5);
    const back = fromBytes(toBytes(unit));
    expect(Array.from(back)).toEqual(Array.from(unit));
  });

  it("reads bytes that start at an unaligned offset", () => {
    const unit = normalize([1, 2, 3]);
    const padded = new Uint8Array(toBytes(unit).length + 3);
    padded.set(toBytes(unit), 3);
    expect(Array.from(fromBytes(padded.subarray(3)))).toEqual(Array.from(unit));
  });

  it("scores identical vectors 1 and orthogonal ones 0", () => {
    const a = normalize([1, 0]);
    expect(dot(a, normalize([5, 0]))).toBeCloseTo(1, 5);
    expect(dot(a, normalize([0, 2]))).toBeCloseTo(0, 5);
  });

  it("treats mismatched sizes and zero vectors as no match", () => {
    expect(dot(normalize([1, 0]), normalize([1, 0, 0]))).toBe(0);
    expect(Array.from(normalize([0, 0]))).toEqual([0, 0]);
  });

  it("ranks and thresholds", () => {
    const hits = topK([1, 5, 3, 9], (n) => n, 2, 4);
    expect(hits.map((h) => h.item)).toEqual([9, 5]);
  });
});
