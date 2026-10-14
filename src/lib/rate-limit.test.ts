import { beforeEach, describe, expect, it } from "vitest";
import { clearAllLimits, hit, peek, reset } from "./rate-limit";

describe("rate limiter", () => {
  beforeEach(() => clearAllLimits());

  it("allows up to the limit, then blocks with a retry time", () => {
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 60_000, 1_000 + i).allowed).toBe(true);
    const blocked = hit("k", 3, 60_000, 2_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(55);
  });

  it("frees capacity as hits age out of the window", () => {
    hit("k", 1, 1_000, 0);
    expect(hit("k", 1, 1_000, 500).allowed).toBe(false);
    expect(hit("k", 1, 1_000, 1_500).allowed).toBe(true);
  });

  it("keeps keys independent and can be reset", () => {
    hit("a", 1, 60_000, 0);
    expect(hit("b", 1, 60_000, 0).allowed).toBe(true);
    expect(hit("a", 1, 60_000, 1).allowed).toBe(false);
    reset("a");
    expect(hit("a", 1, 60_000, 2).allowed).toBe(true);
  });

  it("peek does not consume capacity", () => {
    expect(peek("p", 1, 60_000, 0).allowed).toBe(true);
    expect(peek("p", 1, 60_000, 0).allowed).toBe(true);
    hit("p", 1, 60_000, 0);
    expect(peek("p", 1, 60_000, 1).allowed).toBe(false);
  });
});
