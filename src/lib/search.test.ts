import { describe, expect, it } from "vitest";
import { escapeLike } from "./search";

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("snake_case")).toBe("snake\\_case");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("plain text #1")).toBe("plain text #1");
    expect(escapeLike("")).toBe("");
  });
});
