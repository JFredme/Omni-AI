// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeText, detectKind, extensionOf, matchesSignature, ParseError, parseCsv, parseDocument } from "./parse";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const text = (value: string) => new TextEncoder().encode(value);

describe("file detection", () => {
  it("maps extensions to kinds", () => {
    expect(detectKind("Report.PDF")).toBe("pdf");
    expect(detectKind("notes.md")).toBe("markdown");
    expect(detectKind("main.rs")).toBe("code");
    expect(detectKind("photo.JPEG")).toBe("image");
    expect(detectKind("data.csv")).toBe("csv");
    expect(detectKind("archive.zip")).toBeNull();
    expect(detectKind("noextension")).toBeNull();
    expect(extensionOf("a.b.txt")).toBe("txt");
  });

  it("checks magic bytes so a renamed file is refused", async () => {
    expect(matchesSignature("pdf", "pdf", text("MZ\x90\x00 not a pdf"))).toBe(false);
    await expect(parseDocument("fake.pdf", text("just some text"))).rejects.toBeInstanceOf(ParseError);
    await expect(parseDocument("fake.docx", text("just some text"))).rejects.toThrow(/real \.docx/);
    expect(matchesSignature("image", "png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]))).toBe(true);
    expect(matchesSignature("image", "png", new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });

  it("refuses unsupported types", async () => {
    await expect(parseDocument("a.zip", text("x"))).rejects.toThrow(/isn't supported/);
  });
});

describe("text decoding", () => {
  it("strips a BOM, accepts UTF-8, and refuses binary", () => {
    expect(decodeText(text("﻿hello ✓"))).toBe("hello ✓");
    expect(() => decodeText(new Uint8Array([104, 105, 0, 1, 2]))).toThrow(ParseError);
  });
});

describe("csv", () => {
  it("handles quotes, escaped quotes, embedded newlines, and CRLF", () => {
    expect(parseCsv('name,note\r\n"Smith, J","said ""hi""\nthere"\r\nLee,ok\r\n')).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\nthere'],
      ["Lee", "ok"],
    ]);
  });

  it("detects tab separators and skips blank lines", () => {
    expect(parseCsv("a\tb\n\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseDocument", () => {
  it("reads plain text and Markdown", async () => {
    const parsed = await parseDocument("a.md", text("# Title\n\nSome words."));
    expect(parsed.kind).toBe("markdown");
    expect(parsed.chunks[0].heading).toBe("Title");
  });

  it("rejects empty files", async () => {
    await expect(parseDocument("a.txt", text("   \n"))).rejects.toThrow(/empty/);
  });

  it("reads each page of a PDF and keeps page numbers", async () => {
    const parsed = await parseDocument("sample.pdf", fixture("sample.pdf"));
    expect(parsed.kind).toBe("pdf");
    expect(parsed.chunks.map((c) => c.page)).toEqual([1, 2]);
    expect(parsed.chunks[0].content).toContain("revenue grew by twelve percent");
    expect(parsed.chunks[1].content).toContain("glacier survey");
  });

  it("reads a Word document", async () => {
    const parsed = await parseDocument("sample.docx", fixture("sample.docx"));
    expect(parsed.kind).toBe("docx");
    const all = parsed.chunks.map((c) => c.content).join(" ");
    expect(all).toContain("harbor festival");
    expect(all).toContain("lighthouse at dawn");
  });

  it("reads a spreadsheet with its sheet name and header", async () => {
    const parsed = await parseDocument("sample.xlsx", fixture("sample.xlsx"));
    expect(parsed.kind).toBe("xlsx");
    expect(parsed.chunks[0].heading).toBe("Sales");
    expect(parsed.chunks[0].content).toContain("Product | Units | Region");
    expect(parsed.chunks[0].content).toContain("Teapot | 7 | South");
  });

  it("explains a damaged PDF instead of crashing", async () => {
    await expect(parseDocument("broken.pdf", text("%PDF-1.4\nthis is not a pdf body"))).rejects.toThrow(/PDF/);
  });
});
