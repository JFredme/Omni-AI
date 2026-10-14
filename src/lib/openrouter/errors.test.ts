import { describe, expect, it } from "vitest";
import {
  classifyOpenRouterError,
  OpenRouterError,
  parseErrorBody,
  userMessageFor,
} from "@/lib/openrouter/errors";

describe("classifyOpenRouterError", () => {
  it.each([
    [401, null, null, "invalid_key"],
    [402, null, null, "payment_required"],
    [429, null, null, "rate_limited"],
    [403, null, null, "forbidden"],
    [400, null, null, "bad_request"],
    [404, null, null, "model_unavailable"],
    [503, null, null, "provider_error"],
    [504, null, null, "timeout"],
    [500, null, null, "provider_error"],
  ])("maps HTTP %s (type %s) to %s", (status, errorType, limitSource, expected) => {
    expect(classifyOpenRouterError(status, errorType, limitSource)).toBe(expected);
  });

  it("prefers the typed error_type over the HTTP status", () => {
    expect(classifyOpenRouterError(400, "context_length_exceeded")).toBe("bad_request");
    expect(classifyOpenRouterError(403, "rate_limit_exceeded")).toBe("rate_limited");
    expect(classifyOpenRouterError(200, "authentication")).toBe("invalid_key");
  });

  it("reports budget limits from OpenRouter guardrails", () => {
    expect(classifyOpenRouterError(403, null, "openrouter_key_limit")).toBe("budget_exceeded");
  });
});

describe("parseErrorBody", () => {
  it("extracts message, error type, and limit source", () => {
    expect(
      parseErrorBody(
        { error: { code: 403, message: "Budget", metadata: { error_type: "permission_denied", limit_source: "openrouter_key_limit" } } },
        "fallback",
      ),
    ).toEqual({ message: "Budget", errorType: "permission_denied", limitSource: "openrouter_key_limit" });
  });

  it("falls back to a default message for unknown bodies", () => {
    expect(parseErrorBody("<html>", "fallback")).toEqual({ message: "fallback", errorType: null, limitSource: null });
  });
});

describe("userMessageFor", () => {
  it("gives an actionable message for invalid keys", () => {
    const error = new OpenRouterError("nope", { kind: "invalid_key", status: 401 });
    expect(userMessageFor(error)).toMatch(/rejected the API key/);
  });

  it("explains missing credits", () => {
    const error = new OpenRouterError("nope", { kind: "payment_required", status: 402 });
    expect(userMessageFor(error)).toMatch(/no credits left/);
  });
});
