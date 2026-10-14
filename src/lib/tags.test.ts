import { describe, expect, it } from "vitest";
import { MAX_TAGS, MAX_TAG_LENGTH, normalizeTags, parseTagInput } from "./tags";

describe("tags", () => {
  it("lower-cases, strips #, hyphenates spaces, and removes duplicates and blanks", () => {
    expect(normalizeTags(["#Work", " work ", "Deep Work", "", "  "])).toEqual(["work", "deep-work"]);
  });

  it("caps tag length and count", () => {
    expect(normalizeTags(["x".repeat(100)])[0]).toHaveLength(MAX_TAG_LENGTH);
    expect(normalizeTags(Array.from({ length: 50 }, (_, index) => `t${index}`))).toHaveLength(MAX_TAGS);
  });

  it("parses comma and newline separated input", () => {
    expect(parseTagInput("home, #errands\nfun stuff,")).toEqual(["home", "errands", "fun-stuff"]);
  });
});
