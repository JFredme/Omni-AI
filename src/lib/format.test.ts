import { describe, expect, it } from "vitest";
import { formatContext, formatPricePerMillion, formatTokens, formatUsd } from "@/lib/format";

describe("format helpers", () => {
  it("formats token counts", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(842)).toBe("842");
    expect(formatTokens(12_345)).toBe("12.3K");
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });

  it("formats dollar amounts with enough precision for tiny costs", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.000123)).toBe("$0.00012");
    expect(formatUsd(1.5)).toBe("$1.50");
  });

  it("converts per-token prices to per-million prices", () => {
    expect(formatPricePerMillion(0)).toBe("Free");
    expect(formatPricePerMillion(0.000003)).toBe("$3.00/M");
    expect(formatPricePerMillion(null)).toBe("Price n/a");
  });

  it("formats context windows", () => {
    expect(formatContext(128_000)).toBe("128K ctx");
    expect(formatContext(1_000_000)).toBe("1M ctx");
    expect(formatContext(null)).toBe("Context n/a");
  });
});
