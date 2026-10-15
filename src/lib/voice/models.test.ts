import { describe, expect, it } from "vitest";
import { defaultVoiceFor, estimateVoiceCost, normalizeVoiceModel, sortByPrice } from "./models";

const raw = (id: string, price: string, voices?: string[]) => ({ id, name: id, pricing: { prompt: price, completion: "0" }, supported_voices: voices });

describe("voice models", () => {
  it("sorts cheapest first, with free test models last", () => {
    const models = [raw("a/free", "0"), raw("b/pricey", "0.00004"), raw("c/cheap", "0.00000062"), raw("d/mid", "0.00002")].map((m) => normalizeVoiceModel(m)!);
    expect(sortByPrice(models).map((m) => m.id)).toEqual(["c/cheap", "d/mid", "b/pricey", "a/free"]);
  });
  it("ignores entries without a usable price", () => {
    expect(normalizeVoiceModel(raw("x/y", "-1"))).toBeNull();
    expect(normalizeVoiceModel({ id: "x/z", pricing: {} })).toBeNull();
    expect(normalizeVoiceModel(null)).toBeNull();
  });
  it("picks a friendly default voice", () => {
    expect(defaultVoiceFor(normalizeVoiceModel(raw("hexgrad/kokoro-82m", "0.00000062", ["af_alloy", "af_heart", "am_adam"]))!)).toBe("af_heart");
    expect(defaultVoiceFor(normalizeVoiceModel(raw("o/m", "0.00001", ["zzz", "nova"]))!)).toBe("nova");
    expect(defaultVoiceFor(normalizeVoiceModel(raw("o/m", "0.00001"))!)).toBeNull();
  });
  it("estimates cost from the price", () => {
    expect(estimateVoiceCost(normalizeVoiceModel(raw("a/b", "0.00000062"))!, 1000)).toBeCloseTo(0.00062, 8);
    expect(estimateVoiceCost(undefined, 5)).toBeNull();
  });
});
