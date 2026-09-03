import { describe, expect, it } from "vitest";

import {
  displayFontFamilyName,
  resolveFontFamilySelectValue,
  splitFontFamilyList,
} from "./font-family.js";

describe("font family design tweaks", () => {
  it("parses quoted stacks and resolves known families", () => {
    expect(splitFontFamilyList("'Playfair Display', serif")).toEqual([
      "Playfair Display",
      "serif",
    ]);
    expect(resolveFontFamilySelectValue('"Inter", sans-serif')).toBe(
      "'Inter', sans-serif",
    );
  });

  it("preserves unknown values while displaying their first family", () => {
    expect(resolveFontFamilySelectValue("Brand Sans, sans-serif")).toBe(
      "Brand Sans, sans-serif",
    );
    expect(displayFontFamilyName("Brand Sans, sans-serif")).toBe("Brand Sans");
  });
});
