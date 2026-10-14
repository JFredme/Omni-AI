import { describe, expect, it } from "vitest";
import { estimateCostUsd, isFreeModel, normalizeModel, parsePrice } from "@/lib/openrouter/models";

const baseRaw = {
  id: "vendor/model-a",
  name: "Model A",
  description: "Test model",
  created: 1700000000,
  context_length: 128000,
  pricing: { prompt: "0.000003", completion: "0.000015" },
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  supported_parameters: ["temperature", "tools", "response_format", "reasoning"],
  top_provider: { max_completion_tokens: 4096 },
};

describe("normalizeModel", () => {
  it("maps the OpenRouter payload to the catalog shape", () => {
    const model = normalizeModel(baseRaw);
    expect(model).toMatchObject({
      id: "vendor/model-a",
      name: "Model A",
      contextLength: 128000,
      maxCompletionTokens: 4096,
      promptPrice: 0.000003,
      completionPrice: 0.000015,
      isFree: false,
      inputModalities: ["text", "image"],
      createdAt: 1700000000000,
    });
  });

  it("detects capabilities from parameters and modalities", () => {
    expect(normalizeModel(baseRaw)?.capabilities).toEqual({
      tools: true,
      jsonOutput: true,
      imageInput: true,
      reasoning: true,
    });
  });

  it("reports no capabilities when the model advertises none", () => {
    const model = normalizeModel({ id: "x/plain", pricing: { prompt: "0.1", completion: "0.2" } });
    expect(model?.capabilities).toEqual({ tools: false, jsonOutput: false, imageInput: false, reasoning: false });
    expect(model?.name).toBe("x/plain");
    expect(model?.contextLength).toBeNull();
  });

  it("treats zero-priced models as free, including :free variants", () => {
    expect(normalizeModel({ id: "a/b", pricing: { prompt: "0", completion: "0" } })?.isFree).toBe(true);
    expect(normalizeModel({ id: "a/b:free", pricing: { prompt: "0.5", completion: "1" } })?.isFree).toBe(true);
  });

  it("returns null for entries without an id", () => {
    expect(normalizeModel({ name: "no id" })).toBeNull();
    expect(normalizeModel(null)).toBeNull();
  });
});

describe("parsePrice", () => {
  it("parses string and numeric prices and rejects invalid values", () => {
    expect(parsePrice("0.00002")).toBe(0.00002);
    expect(parsePrice(0)).toBe(0);
    expect(parsePrice("-1")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
});

describe("isFreeModel", () => {
  it("requires both prices to be zero unless the id marks it free", () => {
    expect(isFreeModel("a/b", 0, 0)).toBe(true);
    expect(isFreeModel("a/b", 0, null)).toBe(false);
    expect(isFreeModel("a/b", 0.1, 0)).toBe(false);
  });
});

describe("estimateCostUsd", () => {
  it("multiplies token counts by per-token prices", () => {
    expect(
      estimateCostUsd(
        { promptTokens: 1000, completionTokens: 500 },
        { promptPrice: 0.000003, completionPrice: 0.000015 },
      ),
    ).toBeCloseTo(0.0105, 10);
  });

  it("returns null when prices are unknown", () => {
    expect(estimateCostUsd({ promptTokens: 1, completionTokens: 1 }, { promptPrice: null, completionPrice: 0 })).toBeNull();
  });
});
