import { describe, expect, it } from "vitest";

import {
  formatScrubValue,
  getScrubStepFromEvent,
  parseScrubExpression,
} from "./scrub-input-utils";

describe("scrub input expression parsing", () => {
  it("applies operator-prefixed expressions to the current value", () => {
    expect(parseScrubExpression("/2", 24)?.value).toBe(12);
    expect(parseScrubExpression("+8", 24)?.value).toBe(32);
    expect(parseScrubExpression("*1.5", 24)?.value).toBe(36);
    expect(parseScrubExpression("-4", 24)?.value).toBe(20);
  });

  it("evaluates simple absolute expressions with operator precedence", () => {
    expect(parseScrubExpression("8 + 4 * 2", 0)?.value).toBe(16);
    expect(parseScrubExpression("= -8", 24)?.value).toBe(-8);
  });

  it("strips configured units and normalizes precision", () => {
    expect(
      parseScrubExpression("12.348px", 0, {
        unit: "px",
        precision: 1,
      }),
    ).toEqual({ value: 12.3, normalized: "12.3px" });
  });

  it("clamps to min and max", () => {
    expect(parseScrubExpression("+20", 90, { max: 100 })?.value).toBe(100);
    expect(parseScrubExpression("-20", 10, { min: 0 })?.value).toBe(0);
  });

  it("rejects invalid expressions and division by zero", () => {
    expect(parseScrubExpression("calc(10px)", 0)).toBeNull();
    expect(parseScrubExpression("/0", 24)).toBeNull();
  });

  it("formats values with optional units", () => {
    expect(formatScrubValue(12, { unit: "px" })).toBe("12px");
    expect(formatScrubValue(12.125, { precision: 2 })).toBe("12.13");
  });

  it("preserves at least one decimal digit for unitless precision fields", () => {
    // Line-height: entering "2.0" stores the number 2, but should display "2.0"
    expect(formatScrubValue(2, { precision: 2 })).toBe("2.0");
    expect(formatScrubValue(1.5, { precision: 2 })).toBe("1.5");
    expect(formatScrubValue(1.25, { precision: 2 })).toBe("1.25");
    // Unitless with precision=1: whole numbers keep .0
    expect(formatScrubValue(2, { precision: 1 })).toBe("2.0");
    // Fields with units still strip trailing zeros fully
    expect(formatScrubValue(10, { unit: "px", precision: 1 })).toBe("10px");
    expect(formatScrubValue(10, { unit: "%", precision: 1 })).toBe("10%");
  });

  it("does not strip trailing zeros from integers at precision 0", () => {
    expect(formatScrubValue(100, { precision: 0 })).toBe("100");
    expect(formatScrubValue(50, { precision: 0, unit: "px" })).toBe("50px");
    expect(formatScrubValue(12.5, { precision: 2 })).toBe("12.5");
  });

  it("applies keyboard and pointer step modifiers", () => {
    expect(getScrubStepFromEvent({ shiftKey: true, altKey: false }, 2)).toBe(
      20,
    );
    expect(getScrubStepFromEvent({ shiftKey: false, altKey: true }, 2)).toBe(
      0.2,
    );
  });

  it("accepts a comma decimal separator", () => {
    expect(parseScrubExpression("12,5", 0)?.value).toBe(12.5);
    expect(parseScrubExpression("-12,5", 0)?.value).toBe(-12.5);
    expect(parseScrubExpression("+2,5", 24)?.value).toBe(26.5);
    // Still supports comma decimals inside a larger expression.
    expect(parseScrubExpression("1,5 + 2,5", 0)?.value).toBe(4);
    // Units are stripped before tokenizing, so this still works with a unit.
    expect(
      parseScrubExpression("12,5px", 0, { unit: "px", precision: 1 }),
    ).toEqual({ value: 12.5, normalized: "12.5px" });
  });

  it("rejects a malformed number with more than one decimal separator", () => {
    expect(parseScrubExpression("12,5,6", 0)).toBeNull();
    expect(parseScrubExpression("12.5.6", 0)).toBeNull();
    expect(parseScrubExpression("12,5.6", 0)).toBeNull();
  });
});
