import { describe, expect, it } from "vitest";
import { extractJson } from "./json";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside a code fence, with or without a language tag", () => {
    expect(extractJson('Here you go:\n```json\n{"a": [1, 2]}\n```\nHope that helps')).toEqual({ a: [1, 2] });
    expect(extractJson('```\n{"a":true}\n```')).toEqual({ a: true });
  });

  it("finds the outermost object in surrounding prose", () => {
    expect(extractJson('Sure! {"a":{"b":2}} Anything else?')).toEqual({ a: { b: 2 } });
  });

  it("rejects text without an object, arrays, and truncated JSON", () => {
    expect(() => extractJson("I can't help with that.")).toThrow(/expected format/);
    expect(() => extractJson("[1,2,3]")).toThrow();
    expect(() => extractJson('{"a": [1, 2')).toThrow();
    expect(() => extractJson("")).toThrow();
  });
});
