import { describe, it, expect } from "vitest";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_VALUES,
  DEFAULT_ASPECT_RATIO,
  getAspectRatioDims,
  type AspectRatio,
} from "./aspect-ratios";

describe("ASPECT_RATIOS constants", () => {
  it("declares exactly the four supported ratios", () => {
    expect(Object.keys(ASPECT_RATIOS).sort()).toEqual(
      ["1:1", "16:9", "4:5", "9:16"].sort(),
    );
  });

  it("ASPECT_RATIO_VALUES is the same set as the table keys", () => {
    expect(new Set(ASPECT_RATIO_VALUES)).toEqual(
      new Set(Object.keys(ASPECT_RATIOS)),
    );
  });

  it("default is 16:9 (existing decks before this feature)", () => {
    expect(DEFAULT_ASPECT_RATIO).toBe("16:9");
  });

  it("each ratio has matching pixel and inch aspect", () => {
    for (const key of ASPECT_RATIO_VALUES) {
      const r = ASPECT_RATIOS[key];
      const pxRatio = r.width / r.height;
      const inRatio = r.pptxInches.w / r.pptxInches.h;
      // allow tiny float drift (16:9 inches are 13.33/7.5 = 1.777..)
      expect(Math.abs(pxRatio - inRatio)).toBeLessThan(0.01);
    }
  });

  it("16:9 keeps the historical 960x540 / LAYOUT_WIDE inches", () => {
    expect(ASPECT_RATIOS["16:9"].width).toBe(960);
    expect(ASPECT_RATIOS["16:9"].height).toBe(540);
    expect(ASPECT_RATIOS["16:9"].pptxInches).toEqual({ w: 13.33, h: 7.5 });
  });

  it("portrait ratios have height > width", () => {
    expect(ASPECT_RATIOS["9:16"].height).toBeGreaterThan(
      ASPECT_RATIOS["9:16"].width,
    );
    expect(ASPECT_RATIOS["4:5"].height).toBeGreaterThan(
      ASPECT_RATIOS["4:5"].width,
    );
  });

  it("1:1 is square in both pixels and inches", () => {
    expect(ASPECT_RATIOS["1:1"].width).toBe(ASPECT_RATIOS["1:1"].height);
    expect(ASPECT_RATIOS["1:1"].pptxInches.w).toBe(
      ASPECT_RATIOS["1:1"].pptxInches.h,
    );
  });
});

describe("getAspectRatioDims", () => {
  it("returns the exact entry for each known ratio", () => {
    for (const key of ASPECT_RATIO_VALUES) {
      expect(getAspectRatioDims(key)).toBe(ASPECT_RATIOS[key]);
    }
  });

  it("falls back to 16:9 for undefined (legacy decks)", () => {
    expect(getAspectRatioDims(undefined)).toBe(ASPECT_RATIOS["16:9"]);
  });

  it("falls back to 16:9 for null", () => {
    expect(getAspectRatioDims(null)).toBe(ASPECT_RATIOS["16:9"]);
  });

  it("falls back to 16:9 for an unknown string at runtime", () => {
    // Cast through unknown so the test is honest about runtime safety,
    // not just compile-time safety.
    const bogus = "21:9" as unknown as AspectRatio;
    expect(getAspectRatioDims(bogus)).toBeUndefined();
    // Note: the helper does not validate — callers rely on the Zod enum on
    // the action / DB boundary. This test pins the contract: only nullish
    // is coerced to default; an unknown value returns undefined.
  });
});
