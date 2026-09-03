import { describe, expect, it } from "vitest";

import { resolveLineHeight, sidesAreLinked } from "./style-options";

// ─── resolveLineHeight — px-as-ratio misparse regression ────────────────────
//
// `resolveLineHeight` converts a CSS line-height into the unitless ratio the
// Typography section's numeric field displays/edits. When the browser
// reports a px-computed value (e.g. "19.2px" for a 16px font at ratio 1.2),
// it must be divided by the font-size to recover the ratio. If the font-size
// isn't available/valid, the px string must NOT fall through to the generic
// `parseFloat` path below — that silently reads "19.2px" as the number 19.2
// and would display it directly as if it were already a unitless ratio
// (i.e. a "19.2" line-height instead of "1.2").
describe("resolveLineHeight", () => {
  it("divides a px-computed line-height by font-size to recover the ratio", () => {
    expect(resolveLineHeight("19.2px", "16px")).toBe(1.2);
  });

  it("falls back to the default ratio instead of misreading the raw px number when font-size is missing", () => {
    expect(resolveLineHeight("19.2px", undefined)).toBe(1.2);
    expect(resolveLineHeight("19.2px", "")).toBe(1.2);
  });

  it("falls back to the default ratio when font-size is present but unparsable", () => {
    expect(resolveLineHeight("19.2px", "not-a-size")).toBe(1.2);
  });

  it("falls back to the default ratio when font-size resolves to zero", () => {
    expect(resolveLineHeight("19.2px", "0px")).toBe(1.2);
  });

  it("returns the default ratio for 'normal' or empty values", () => {
    expect(resolveLineHeight("normal", "16px")).toBe(1.2);
    expect(resolveLineHeight(undefined, "16px")).toBe(1.2);
    expect(resolveLineHeight("", "16px")).toBe(1.2);
  });

  it("parses an already-unitless ratio directly", () => {
    expect(resolveLineHeight("1.5", "16px")).toBe(1.5);
  });
});

describe("sidesAreLinked", () => {
  it("is true when all four sides parse to the same number", () => {
    expect(
      sidesAreLinked({ top: "4px", right: "4px", bottom: "4px", left: "4px" }),
    ).toBe(true);
  });

  it("is false when any side differs", () => {
    expect(
      sidesAreLinked({ top: "4px", right: "8px", bottom: "4px", left: "4px" }),
    ).toBe(false);
  });

  it("treats missing sides as 0", () => {
    expect(
      sidesAreLinked({ top: "", right: "0px", bottom: "0", left: "" }),
    ).toBe(true);
  });
});
