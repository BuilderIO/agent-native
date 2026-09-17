import { describe, expect, it } from "vitest";

import {
  displayFontFamilyName,
  resolveFontFamilySelectValue,
  sortFontFamilyOptions,
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

  it("sorts font options alphabetically while keeping inherit first", () => {
    expect(
      sortFontFamilyOptions([
        { value: "z", label: "Zed" },
        { value: "inherit", label: "Default" },
        { value: "a", label: "Arial" },
        { value: "i", label: "Inter" },
      ]),
    ).toEqual([
      { value: "inherit", label: "Default" },
      { value: "a", label: "Arial" },
      { value: "i", label: "Inter" },
      { value: "z", label: "Zed" },
    ]);
  });
});
