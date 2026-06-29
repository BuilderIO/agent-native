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

  it("does not strip trailing zeros from integers at precision 0", () => {
    expect(formatScrubValue(100, { precision: 0 })).toBe("100");
    expect(formatScrubValue(50, { precision: 0, unit: "px" })).toBe("50px");
    expect(formatScrubValue(10.0, { precision: 1 })).toBe("10");
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
});
