import { describe, expect, it } from "vitest";

import { MIXED_VALUE } from "./selection-helpers";
import {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  isKnownFontWeight,
  resolveFixedResizeDimension,
  resolveFontFamilyFieldValue,
  resolveFontFamilySelectValue,
  splitFontFamilyList,
} from "./typography-helpers";

// ---------------------------------------------------------------------------
// splitFontFamilyList / resolveFontFamilySelectValue — font-family stack
// parsing must be case-insensitive and quote/whitespace tolerant so a
// computed "Inter", "'Inter', sans-serif", or " inter , sans-serif " all
// resolve to the same known FONT_FAMILY_OPTIONS entry.
// ---------------------------------------------------------------------------

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
    // e.g. a computed style tail that differs from our canonical fallback
    // stack should still resolve by first-family name.
    expect(resolveFontFamilySelectValue("Inter, Arial, sans-serif")).toBe(
      "'Inter', sans-serif",
    );
  });

  it("returns the generic default for an empty/undefined value", () => {
    expect(resolveFontFamilySelectValue(undefined)).toBe("sans-serif");
    expect(resolveFontFamilySelectValue("")).toBe("sans-serif");
  });

  it("passes through an unrecognized font stack unchanged (no silent default)", () => {
    // Previously any unmatched value should surface as its own trimmed raw
    // string, not silently fall back to the first FONT_FAMILY_OPTIONS entry.
    expect(resolveFontFamilySelectValue("Roboto, sans-serif")).toBe(
      "Roboto, sans-serif",
    );
    expect(resolveFontFamilySelectValue(FONT_FAMILY_OPTIONS[0].value)).not.toBe(
      "Roboto, sans-serif",
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

// ---------------------------------------------------------------------------
// resolveFontFamilyFieldValue — mixed-selection safety. A multi-selection
// spanning different fonts must resolve to the MIXED_VALUE sentinel so the
// caller can render it as a disabled placeholder instead of a normal,
// clickable option (bug: previously this coincidentally worked because
// MIXED_VALUE's literal text happens to be "Mixed", but nothing marked it as
// non-selectable — see typography-properties.tsx for the fix).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// isKnownFontWeight — every FONT_WEIGHT_OPTIONS notch must be recognized;
// a variable-font weight outside those nine must not be, so the caller can
// inject a synthesized option (bug: previously an off-notch weight like
// "550" left the font-weight Select's value matching no item — rendered
// blank even though the real weight was still applied).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// resolveFixedResizeDimension — converting auto-width/auto-height text to
// "fixed" must preserve the element's real authored size when present, and
// otherwise fall back to its actual current rendered size (boundingRect),
// never an arbitrary hardcoded constant (bug: the prior "200px"/"48px"
// defaults caused a visible size jump on every auto -> fixed conversion for
// a box that had never been explicitly sized).
// ---------------------------------------------------------------------------

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
