import { describe, expect, it } from "vitest";

import { nextBoldFontWeight, nextItalicFontStyle } from "./text-style-toggle";

describe("nextBoldFontWeight", () => {
  it("bolds regular and light text and returns bold text to regular", () => {
    expect(nextBoldFontWeight("400")).toBe("700");
    expect(nextBoldFontWeight("300")).toBe("700");
    expect(nextBoldFontWeight("500")).toBe("700");
    expect(nextBoldFontWeight("600")).toBe("400");
    expect(nextBoldFontWeight("700")).toBe("400");
    expect(nextBoldFontWeight("bold")).toBe("400");
    expect(nextBoldFontWeight("normal")).toBe("700");
    expect(nextBoldFontWeight(undefined)).toBe("700");
  });
});

describe("nextItalicFontStyle", () => {
  it("toggles between italic and normal", () => {
    expect(nextItalicFontStyle("normal")).toBe("italic");
    expect(nextItalicFontStyle(undefined)).toBe("italic");
    expect(nextItalicFontStyle("italic")).toBe("normal");
    expect(nextItalicFontStyle("oblique 10deg")).toBe("normal");
  });
});
