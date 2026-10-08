import { describe, expect, it } from "vitest";

import { MIXED_VALUE } from "./selection-helpers";
import {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  isKnownFontWeight,
  isTextDecorationLineActive,
  letterSpacingScrubCssValue,
  nextTextDecorationLineValue,
  parseLetterSpacingInput,
  parseLineHeightInput,
  resolveLetterSpacingFieldValue,
  parseTextDecorationLineTokens,
  resolveLineHeightFieldValue,
  resolveFixedResizeDimension,
  resolveFontFamilyFieldValue,
  resolveFontFamilySelectValue,
  splitFontFamilyList,
  TEXT_TRUNCATION_ORIGINAL_DISPLAY,
  TEXT_TRUNCATION_ORIGINAL_OVERFLOW,
  textTruncationLineCount,
  textTruncationStyleChanges,
  TEXT_CASE_OPTIONS,
} from "./typography-helpers";

describe("splitFontFamilyList", () => {
  it("splits a plain comma-separated stack", () => {
    expect(splitFontFamilyList("Inter, sans-serif")).toEqual([
      "Inter",
      "sans-serif",
    ]);
  });

  it("strips single and double quotes around family names", () => {
    expect(splitFontFamilyList("'Inter', sans-serif")).toEqual([
      "Inter",
      "sans-serif",
    ]);
    expect(splitFontFamilyList('"Playfair Display", serif')).toEqual([
      "Playfair Display",
      "serif",
    ]);
  });

  it("does not split on a comma inside a quoted family name", () => {
    expect(splitFontFamilyList('"Foo, Bar", serif')).toEqual([
      "Foo, Bar",
      "serif",
    ]);
  });

  it("returns an empty array for undefined/empty input", () => {
    expect(splitFontFamilyList(undefined)).toEqual([]);
    expect(splitFontFamilyList("")).toEqual([]);
    expect(splitFontFamilyList("   ")).toEqual([]);
  });
});

describe("resolveFontFamilySelectValue", () => {
  it("resolves an unquoted stack to the matching option", () => {
    expect(resolveFontFamilySelectValue("Inter, sans-serif")).toBe(
      "'Inter', sans-serif",
    );
  });

  it("resolves a quoted stack to the same option", () => {
    expect(resolveFontFamilySelectValue("'Inter', sans-serif")).toBe(
      "'Inter', sans-serif",
    );
  });

  it("is case-insensitive", () => {
    expect(resolveFontFamilySelectValue("INTER, SANS-SERIF")).toBe(
      "'Inter', sans-serif",
    );
    expect(resolveFontFamilySelectValue("inter, sans-serif")).toBe(
      "'Inter', sans-serif",
    );
  });

  it("tolerates extra whitespace around family names", () => {
    expect(resolveFontFamilySelectValue("  Inter  ,   sans-serif  ")).toBe(
      "'Inter', sans-serif",
    );
  });

  it("falls back to matching on the first family when the full stack differs", () => {
    expect(resolveFontFamilySelectValue("Inter, Arial, sans-serif")).toBe(
      "'Inter', sans-serif",
    );
  });

  it("returns the generic default for an empty/undefined value", () => {
    expect(resolveFontFamilySelectValue(undefined)).toBe("sans-serif");
    expect(resolveFontFamilySelectValue("")).toBe("sans-serif");
  });

  it("passes through an unrecognized font stack unchanged (no silent default)", () => {
    expect(resolveFontFamilySelectValue("No Such Font, sans-serif")).toBe(
      "No Such Font, sans-serif",
    );
    expect(resolveFontFamilySelectValue(FONT_FAMILY_OPTIONS[0].value)).not.toBe(
      "No Such Font, sans-serif",
    );
  });
});

describe("displayFontFamilyName", () => {
  it("maps known generic families to friendly labels", () => {
    expect(displayFontFamilyName("sans-serif")).toBe("Sans Serif");
    expect(displayFontFamilyName("serif")).toBe("Serif");
    expect(displayFontFamilyName("monospace")).toBe("Monospace");
    expect(displayFontFamilyName("system-ui")).toBe("System UI");
    expect(displayFontFamilyName("-apple-system")).toBe("System UI");
    expect(displayFontFamilyName("BlinkMacSystemFont")).toBe("Apple System");
  });

  it("returns the first family name verbatim for an unknown font", () => {
    expect(displayFontFamilyName("Roboto, sans-serif")).toBe("Roboto");
  });

  it("falls back to a generic label when there is no value", () => {
    expect(displayFontFamilyName(undefined)).toBe("Sans Serif");
    expect(displayFontFamilyName("")).toBe("Sans Serif");
  });
});

describe("resolveFontFamilyFieldValue", () => {
  it("returns the MIXED_VALUE sentinel unchanged for a mixed selection", () => {
    expect(resolveFontFamilyFieldValue(MIXED_VALUE)).toBe(MIXED_VALUE);
  });

  it("resolves a non-mixed value exactly like resolveFontFamilySelectValue", () => {
    expect(resolveFontFamilyFieldValue("Inter, sans-serif")).toBe(
      resolveFontFamilySelectValue("Inter, sans-serif"),
    );
    expect(resolveFontFamilyFieldValue(undefined)).toBe(
      resolveFontFamilySelectValue(undefined),
    );
  });
});

describe("isKnownFontWeight", () => {
  it("recognizes every standard notch", () => {
    for (const option of FONT_WEIGHT_OPTIONS) {
      expect(isKnownFontWeight(option.value)).toBe(true);
    }
  });

  it("rejects an off-notch variable-font weight", () => {
    expect(isKnownFontWeight("550")).toBe(false);
    expect(isKnownFontWeight("650")).toBe(false);
  });

  it("rejects a non-numeric keyword the computed style didn't normalize", () => {
    expect(isKnownFontWeight("bold")).toBe(false);
    expect(isKnownFontWeight("normal")).toBe(false);
  });
});

describe("resolveFixedResizeDimension", () => {
  it("preserves an existing authored (non-auto) size verbatim", () => {
    expect(resolveFixedResizeDimension("240px", false, 999)).toBe("240px");
  });

  it("falls back to the current rendered bounding size when auto", () => {
    expect(resolveFixedResizeDimension(undefined, true, 340)).toBe("340px");
    expect(resolveFixedResizeDimension("max-content", true, 128.4)).toBe(
      "128px",
    );
  });

  it("rounds a fractional bounding size to the nearest whole pixel", () => {
    expect(resolveFixedResizeDimension(undefined, true, 199.6)).toBe("200px");
  });

  it("never emits a zero or negative fallback size", () => {
    expect(resolveFixedResizeDimension(undefined, true, 0)).toBe("1px");
    expect(resolveFixedResizeDimension(undefined, true, -5)).toBe("1px");
  });

  it("treats a non-finite bounding size as zero rather than NaN", () => {
    expect(resolveFixedResizeDimension(undefined, true, Number.NaN)).toBe(
      "1px",
    );
  });
});

describe("line-height field values", () => {
  it("preserves authored px and percent values across the computed px fallback", () => {
    expect(resolveLineHeightFieldValue("30%", "24px", "16px")).toEqual({
      text: "30%",
      value: 30,
      unit: "%",
    });
    expect(resolveLineHeightFieldValue("30px", "24px", "16px")).toEqual({
      text: "30px",
      value: 30,
      unit: "px",
    });
  });

  it("shows legacy unitless ratios as percentages without changing them", () => {
    expect(resolveLineHeightFieldValue("1.5", "24px", "16px")).toEqual({
      text: "150%",
      value: 150,
      unit: "%",
    });
  });

  it("uses computed pixels for Auto scrub steps and accepts Figma input units", () => {
    const auto = resolveLineHeightFieldValue("normal", "19.2px", "16px");
    expect(auto).toEqual({ text: "Auto", value: 19.2, unit: "px" });
    expect(parseLineHeightInput("30", auto)).toMatchObject({
      text: "30px",
      value: 30,
      unit: "px",
      cssValue: "30px",
    });
    expect(parseLineHeightInput("150%", auto)).toMatchObject({
      text: "150%",
      value: 150,
      unit: "%",
      cssValue: "150%",
    });
    expect(parseLineHeightInput("Auto", auto)).toMatchObject({
      text: "Auto",
      cssValue: "normal",
    });
  });

  it("uses a measured normal line box when computed CSS remains Auto", () => {
    expect(
      resolveLineHeightFieldValue("normal", "normal", "16px", "19px"),
    ).toEqual({ text: "Auto", value: 19, unit: "px" });
  });

  it("defaults bare input to pixels from percentage mode", () => {
    expect(parseLineHeightInput("30", { value: 150, unit: "%" })).toMatchObject(
      {
        text: "30px",
        value: 30,
        unit: "px",
        cssValue: "30px",
      },
    );
    expect(parseLineHeightInput("0", { value: 125, unit: "%" })).toMatchObject({
      text: "0px",
      value: 0,
      unit: "px",
      cssValue: "0px",
    });
    expect(parseLineHeightInput("+5", { value: 150, unit: "%" })).toMatchObject(
      {
        text: "5px",
        value: 5,
        unit: "px",
        cssValue: "5px",
      },
    );
    expect(
      parseLineHeightInput("150%", { value: 19, unit: "px" }),
    ).toMatchObject({
      text: "150%",
      value: 150,
      unit: "%",
      cssValue: "150%",
    });
    expect(parseLineHeightInput("nope", { value: 125, unit: "%" })).toBeNull();
  });

  it("rejects a malformed doubled unit suffix instead of silently stripping both", () => {
    expect(parseLineHeightInput("2pxpx", { value: 16, unit: "px" })).toBeNull();
    expect(parseLineHeightInput("1.5%%", { value: 16, unit: "px" })).toBeNull();
    expect(
      parseLineHeightInput("24px", { value: 16, unit: "px" }),
    ).toMatchObject({ text: "24px", value: 24, unit: "px", cssValue: "24px" });
    expect(
      parseLineHeightInput("1.5", { value: 16, unit: "px" }),
    ).toMatchObject({ text: "1.5px", value: 1.5, unit: "px" });
  });
});

describe("parseTextDecorationLineTokens", () => {
  it("returns an empty set for none/undefined/empty", () => {
    expect(parseTextDecorationLineTokens(undefined).size).toBe(0);
    expect(parseTextDecorationLineTokens("").size).toBe(0);
    expect(parseTextDecorationLineTokens("none").size).toBe(0);
  });

  it("parses a single line keyword", () => {
    expect(parseTextDecorationLineTokens("underline")).toEqual(
      new Set(["underline"]),
    );
    expect(parseTextDecorationLineTokens("line-through")).toEqual(
      new Set(["line-through"]),
    );
  });

  it("parses multiple space-separated line keywords", () => {
    expect(parseTextDecorationLineTokens("underline line-through")).toEqual(
      new Set(["underline", "line-through"]),
    );
  });

  it("picks the line keyword out of a full shorthand computed string", () => {
    expect(
      parseTextDecorationLineTokens("underline solid rgb(0, 0, 0)"),
    ).toEqual(new Set(["underline"]));
  });
});

describe("isTextDecorationLineActive", () => {
  it("reports true only when the line is present", () => {
    expect(isTextDecorationLineActive("underline", "underline")).toBe(true);
    expect(isTextDecorationLineActive("underline", "line-through")).toBe(false);
    expect(isTextDecorationLineActive("none", "underline")).toBe(false);
    expect(isTextDecorationLineActive(undefined, "underline")).toBe(false);
  });

  it("treats a mixed-selection sentinel as inactive, never active", () => {
    expect(isTextDecorationLineActive(MIXED_VALUE, "underline")).toBe(false);
    expect(isTextDecorationLineActive(MIXED_VALUE, "line-through")).toBe(false);
  });
});

describe("nextTextDecorationLineValue", () => {
  it("turns a line on from none", () => {
    expect(nextTextDecorationLineValue("none", "underline")).toBe("underline");
    expect(nextTextDecorationLineValue(undefined, "underline")).toBe(
      "underline",
    );
  });

  it("turns a line off, falling back to none when nothing is left active", () => {
    expect(nextTextDecorationLineValue("underline", "underline")).toBe("none");
  });

  it("adds a second line without clobbering the first", () => {
    expect(nextTextDecorationLineValue("underline", "line-through")).toBe(
      "underline line-through",
    );
  });

  it("removes one of two active lines, keeping the other", () => {
    expect(
      nextTextDecorationLineValue("underline line-through", "underline"),
    ).toBe("line-through");
  });

  it("treats a mixed selection as no lines active, so the click sets it uniformly", () => {
    expect(nextTextDecorationLineValue(MIXED_VALUE, "underline")).toBe(
      "underline",
    );
  });
});

describe("TEXT_CASE_OPTIONS", () => {
  it("exposes exactly the four supported text-transform keywords", () => {
    expect(TEXT_CASE_OPTIONS.map((option) => option.value)).toEqual([
      "none",
      "uppercase",
      "lowercase",
      "capitalize",
    ]);
  });
});

describe("text truncation styles", () => {
  const requireStyleChanges = (
    changes: Record<string, string> | null,
  ): Record<string, string> => {
    if (!changes) throw new Error("Expected truncation style changes");
    return changes;
  };

  it("reads only positive integer clamp values", () => {
    expect(textTruncationLineCount("1")).toBe(1);
    expect(textTruncationLineCount("12")).toBe(12);
    expect(textTruncationLineCount("none")).toBeNull();
    expect(textTruncationLineCount("0")).toBeNull();
    expect(textTruncationLineCount("1.5")).toBeNull();
  });

  it("keeps original inline display and overflow across disable and re-enable", () => {
    const enabled = requireStyleChanges(
      textTruncationStyleChanges(true, 3, {
        display: "inline-block",
        overflow: "clip",
      }),
    );
    expect(enabled).toMatchObject({
      display: "-webkit-box",
      webkitBoxOrient: "vertical",
      webkitLineClamp: "3",
      overflow: "hidden",
      [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: '"inline-block"',
      [TEXT_TRUNCATION_ORIGINAL_OVERFLOW]: '"clip"',
    });

    const disabled = requireStyleChanges(
      textTruncationStyleChanges(false, 3, enabled),
    );
    expect(disabled).toMatchObject({
      display: "inline-block",
      webkitBoxOrient: "horizontal",
      webkitLineClamp: "none",
      overflow: "clip",
      [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: "initial",
      [TEXT_TRUNCATION_ORIGINAL_OVERFLOW]: "initial",
    });

    const enabledAgain = requireStyleChanges(
      textTruncationStyleChanges(true, 2, {
        ...disabled,
        display: "grid",
        overflow: "scroll",
      }),
    );
    expect(enabledAgain).toMatchObject({
      [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: '"grid"',
      [TEXT_TRUNCATION_ORIGINAL_OVERFLOW]: '"scroll"',
    });

    expect(textTruncationStyleChanges(false, 2, enabledAgain)).toMatchObject({
      display: "grid",
      overflow: "scroll",
    });
  });

  it("restores CSS-wide values and falls back to the stylesheet for absent values", () => {
    const enabled = requireStyleChanges(
      textTruncationStyleChanges(true, 1, {
        display: "initial",
        overflow: "clip",
      }),
    );
    expect(enabled).toMatchObject({
      [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: '"initial"',
    });
    expect(textTruncationStyleChanges(false, 1, enabled)).toMatchObject({
      display: "initial",
      overflow: "clip",
    });

    const classBacked = requireStyleChanges(
      textTruncationStyleChanges(true, 1, {}),
    );
    expect(classBacked).toMatchObject({
      [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: '""',
      [TEXT_TRUNCATION_ORIGINAL_OVERFLOW]: '""',
    });
    expect(textTruncationStyleChanges(false, 1, classBacked)).toEqual({
      display: "revert-layer",
      webkitBoxOrient: "horizontal",
      webkitLineClamp: "none",
      overflow: "revert-layer",
      [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: "initial",
      [TEXT_TRUNCATION_ORIGINAL_OVERFLOW]: "initial",
    });
  });

  it("refuses malformed restore metadata instead of guessing", () => {
    expect(
      textTruncationStyleChanges(false, 1, {
        [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: "not-json",
        [TEXT_TRUNCATION_ORIGINAL_OVERFLOW]: '"hidden"',
      }),
    ).toBeNull();
    expect(
      textTruncationStyleChanges(false, 1, {
        [TEXT_TRUNCATION_ORIGINAL_DISPLAY]: '"block"',
      }),
    ).toBeNull();
    expect(textTruncationStyleChanges(true, 0, {})).toBeNull();
  });
});

describe("parseLetterSpacingInput / resolveLetterSpacingFieldValue", () => {
  const px = { value: 0, unit: "px" as const };
  const pct = { value: 2, unit: "%" as const };

  it("turns a percentage into em and shows it as a percentage", () => {
    expect(parseLetterSpacingInput("2%", px)).toEqual({
      text: "2%",
      value: 2,
      unit: "%",
      cssValue: "0.02em",
    });
  });

  it("keeps an explicit em value as a percentage field", () => {
    expect(parseLetterSpacingInput("0.05em", px)).toMatchObject({
      text: "5%",
      cssValue: "0.05em",
    });
  });

  it("keeps a bare number in the field's current unit", () => {
    expect(parseLetterSpacingInput("0.64", px)?.cssValue).toBe("0.64px");
    expect(parseLetterSpacingInput("3", pct)?.cssValue).toBe("0.03em");
    expect(parseLetterSpacingInput("-1.5px", pct)?.cssValue).toBe("-1.5px");
  });

  it("rejects text that is not a number", () => {
    expect(parseLetterSpacingInput("wide", px)).toBeNull();
  });

  it("rejects a malformed doubled or mismatched unit suffix instead of silently stripping both", () => {
    expect(parseLetterSpacingInput("2pxpx", px)).toBeNull();
    expect(parseLetterSpacingInput("2px px", px)).toBeNull();
    expect(parseLetterSpacingInput("2%%", px)).toBeNull();
    expect(parseLetterSpacingInput("2em%", px)).toBeNull();
    expect(parseLetterSpacingInput("2px", pct)?.cssValue).toBe("2px");
    expect(parseLetterSpacingInput("2", px)?.cssValue).toBe("2px");
    // A unit embedded mid-expression, followed by further arithmetic
    // (not another unit token), is not "doubled" and must keep working.
    expect(
      parseLetterSpacingInput("(x+1)px", { value: 0.64, unit: "px" }),
    ).toMatchObject({ cssValue: "1.64px" });
  });

  it("keeps small percent tracking precise enough to round-trip through em", () => {
    expect(parseLetterSpacingInput("0.01%", px)).toEqual({
      text: "0.01%",
      value: 0.01,
      unit: "%",
      cssValue: "0.0001em",
    });
    expect(parseLetterSpacingInput("2.35%", px)).toMatchObject({
      cssValue: "0.0235em",
    });
    expect(resolveLetterSpacingFieldValue("0.0235em", "0.64px")).toEqual({
      text: "2.35%",
      value: 2.35,
      unit: "%",
    });
  });

  it("parses an em input in em precision, not percent precision", () => {
    expect(parseLetterSpacingInput("0.005em", px)).toEqual({
      text: "0.5%",
      value: 0.5,
      unit: "%",
      cssValue: "0.005em",
    });
  });

  it("refuses an x expression whose explicit unit's dimension doesn't match the field's current unit", () => {
    const currentPx = { value: 0.64, unit: "px" as const };
    expect(parseLetterSpacingInput("(x+0.005em)*2", currentPx)).toBeNull();
    expect(parseLetterSpacingInput("0.005em", currentPx)).toEqual({
      text: "0.5%",
      value: 0.5,
      unit: "%",
      cssValue: "0.005em",
    });
    expect(parseLetterSpacingInput("x+1", currentPx)).toMatchObject({
      cssValue: "1.64px",
    });

    const currentPct = { value: 2, unit: "%" as const };
    expect(parseLetterSpacingInput("(x+0.5)%", currentPct)).toMatchObject({
      text: "2.5%",
    });
    expect(parseLetterSpacingInput("x*2px", currentPct)).toBeNull();
    expect(parseLetterSpacingInput("(x+0.005em)*2", currentPct)).toEqual({
      text: "5%",
      value: 5,
      unit: "%",
      cssValue: "0.05em",
    });
  });

  it("resolves an authored em as a percentage and px otherwise", () => {
    expect(resolveLetterSpacingFieldValue("0.02em", "0.64px")).toEqual({
      text: "2%",
      value: 2,
      unit: "%",
    });
    expect(resolveLetterSpacingFieldValue("2px", "2px")).toEqual({
      text: "2px",
      value: 2,
      unit: "px",
    });
    expect(resolveLetterSpacingFieldValue(undefined, "normal")).toMatchObject({
      unit: "px",
    });
  });
});

describe("letterSpacingScrubCssValue", () => {
  it("keeps small percent tracking precise enough to round-trip through em", () => {
    expect(letterSpacingScrubCssValue(0.01, "%")).toBe("0.0001em");
  });
});
