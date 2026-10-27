import { describe, expect, it } from "vitest";

import { formatScrubValue, parseScrubExpression } from "./scrub-input-utils.js";

describe("parseScrubExpression units", () => {
  it.each([
    ["160", "px", 160],
    ["160px", "px", 160],
    ["-12.5px", "px", -12.5],
    ["45deg", "deg", 45],
    ["45°", "deg", 45],
    ["45°", "°", 45],
    ["45deg", "°", 45],
    ["50%", "%", 50],
  ])("reads %s in a %s field as %s", (input, unit, expected) => {
    expect(parseScrubExpression(input, 0, { unit })?.value).toBe(expected);
  });

  it("rejects text that is not a number in the field's unit", () => {
    expect(parseScrubExpression("12abc", 0, { unit: "px" })).toBeNull();
    expect(parseScrubExpression("45°", 0, { unit: "px" })).toBeNull();
    expect(parseScrubExpression("50%", 0, { unit: "px" })).toBeNull();
  });

  it("formats with the display unit while trimming like the parse unit", () => {
    expect(formatScrubValue(160, { unit: "px", precision: 1 })).toBe("160px");
    expect(
      formatScrubValue(160, { unit: "px", displayUnit: "", precision: 1 }),
    ).toBe("160");
    expect(
      formatScrubValue(12.5, { unit: "deg", displayUnit: "°", precision: 2 }),
    ).toBe("12.5°");
    expect(
      parseScrubExpression("160px", 0, {
        unit: "px",
        displayUnit: "",
        precision: 1,
      }),
    ).toEqual({ value: 160, normalized: "160" });
  });
});
