import { describe, expect, it } from "vitest";
import { getGreeting } from "@/lib/greeting";

function at(hour: number, minute = 0) {
  return new Date(2026, 0, 15, hour, minute);
}

describe("getGreeting", () => {
  it.each([
    [0, "Good night"],
    [4, "Good night"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [17, "Good afternoon"],
    [18, "Good evening"],
    [23, "Good evening"],
  ])("returns the right greeting at hour %i", (hour, expected) => {
    expect(getGreeting(at(hour))).toBe(expected);
  });

  it("uses the hour boundary exactly, ignoring minutes", () => {
    expect(getGreeting(at(11, 59))).toBe("Good morning");
    expect(getGreeting(at(17, 59))).toBe("Good afternoon");
  });
});
