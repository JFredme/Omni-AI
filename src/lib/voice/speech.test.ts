import { describe, expect, it } from "vitest";
import { encodeWav, SpeechDetector, takeSentences, toBase64, toSpeakable } from "./speech";

describe("toSpeakable", () => {
  it("removes markdown, code, links and emoji", () => {
    expect(toSpeakable("## Title\n- **Bold** point with `code`\n1. Next [site](https://a.com) 😀")).toBe("Title Bold point with code Next site");
    expect(toSpeakable("See https://example.com/x now")).toBe("See a link now");
    expect(toSpeakable("```js\nalert(1)\n```")).toBe("");
  });
});

describe("takeSentences", () => {
  it("releases complete sentences and keeps the unfinished one", () => {
    expect(takeSentences("Hello there. How are you? I am")).toEqual({ sentences: ["Hello there.", "How are you?"], rest: "I am" });
  });
  it("waits at the end of the buffer in case a sentence is not finished, until final", () => {
    expect(takeSentences("Version 3.")).toEqual({ sentences: [], rest: "Version 3." });
    expect(takeSentences("Version 3.", { final: true })).toEqual({ sentences: ["Version 3."], rest: "" });
  });
  it("flushes the remainder when final", () => {
    expect(takeSentences("One. Two without a stop", { final: true }).sentences).toEqual(["One.", "Two without a stop"]);
  });
  it("lets speech start early with a first clause", () => {
    const out = takeSentences("That is a really good question to ask, and the answer depends on what you mean by it", { first: true });
    expect(out.sentences).toEqual(["That is a really good question to ask,"]);
    expect(takeSentences("Well, it depends a lot on what you mean by that", { first: true }).sentences).toEqual([]);
  });
  it("breaks up a very long run at a comma", () => {
    const long = `${"word ".repeat(30)}and then, ${"more ".repeat(20)}`;
    expect(takeSentences(long).sentences.length).toBeGreaterThan(0);
  });
});

describe("SpeechDetector", () => {
  it("detects the start and end of speech, and ignores short blips", () => {
    const d = new SpeechDetector({ startMs: 100, endMs: 500 });
    const events: (string | null)[] = [];
    for (let i = 0; i < 10; i += 1) events.push(d.push(0.003, 50)); // quiet room
    events.push(d.push(0.2, 50)); // blip
    for (let i = 0; i < 6; i += 1) events.push(d.push(0.003, 50));
    expect(events.filter(Boolean)).toEqual([]);
    for (let i = 0; i < 4; i += 1) events.push(d.push(0.2, 50)); // speech
    for (let i = 0; i < 12; i += 1) events.push(d.push(0.003, 50)); // silence
    expect(events.filter(Boolean)).toEqual(["start", "end"]);
  });
});

describe("encodeWav", () => {
  it("makes a 16 kHz mono WAV", () => {
    const one = new Float32Array(48_000).fill(0.5); // one second at 48 kHz
    const { bytes, seconds } = encodeWav([one], 48_000);
    expect(seconds).toBeCloseTo(1, 2);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(bytes.length).toBe(44 + 16_000 * 2);
    expect(toBase64(bytes.slice(0, 3))).toBe("UklG");
  });
});
