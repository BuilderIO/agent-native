import { describe, expect, it } from "vitest";

import { formatCurrency } from "./format";

describe("formatCurrency", () => {
  it("puts the sign before the dollar sign", () => {
    expect(formatCurrency(-1_500_000)).toBe("-$1.5M");
    expect(formatCurrency(-2_500)).toBe("-$2.5k");
    expect(formatCurrency(-42)).toBe("-$42");
    expect(formatCurrency(1_500_000)).toBe("$1.5M");
  });

  it("does not render negative zero", () => {
    expect(formatCurrency(-0.2)).toBe("$0");
  });
});
