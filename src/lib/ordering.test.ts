import { describe, expect, it } from "vitest";
import { POSITION_STEP, positionBetween } from "./ordering";

describe("positionBetween", () => {
  it("handles empty, first, last, and middle slots", () => {
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
    expect(positionBetween(null, 10)).toBeLessThan(10);
    expect(positionBetween(10, null)).toBeGreaterThan(10);
    expect(positionBetween(10, 20)).toBe(15);
  });

  it("keeps strict order after repeated insertion at the same spot", () => {
    let upper = 1024;
    const lower = 0;
    for (let index = 0; index < 30; index += 1) {
      const next = positionBetween(lower, upper);
      expect(next).toBeGreaterThan(lower);
      expect(next).toBeLessThan(upper);
      upper = next;
    }
  });
});
