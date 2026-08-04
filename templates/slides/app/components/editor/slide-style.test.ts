import { describe, expect, it } from "vitest";

import {
  backgroundCssValue,
  formatValue,
  horizontalAlignPatch,
  resolveHorizontalAlignment,
  resolveVerticalAlignment,
  rotationTransform,
  verticalAlignPatch,
  type SlideStyleSnapshot,
} from "./slide-style";

function snapshot(
  overrides: Partial<SlideStyleSnapshot> = {},
): SlideStyleSnapshot {
  return {
    selector: '[data-slide-object-id="object-a"]',
    label: "Heading",
    tagName: "H2",
    textPreview: "Heading",
    isText: true,
    isImage: false,
    isAbsolute: true,
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    rotation: 0,
    slideWidth: 1280,
    slideHeight: 720,
    color: "#ffffff",
    backgroundColor: "transparent",
    fontSize: 40,
    fontWeight: "700",
    fontStyle: "normal",
    textDecoration: "none",
    lineHeight: 1.2,
    textAlign: "left",
    opacity: 100,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "#000000",
    paddingX: 0,
    paddingY: 0,
    zIndex: 1,
    ...overrides,
  };
}

describe("alignment", () => {
  it("centres against the slide box, not the object origin", () => {
    expect(horizontalAlignPatch(snapshot(), "center")).toEqual({
      left: "440px",
    });
    expect(verticalAlignPatch(snapshot(), "middle")).toEqual({ top: "260px" });
  });

  it("pins to the far edge for right and bottom", () => {
    expect(horizontalAlignPatch(snapshot(), "right")).toEqual({
      left: "880px",
    });
    expect(verticalAlignPatch(snapshot(), "bottom")).toEqual({ top: "520px" });
  });

  it("never produces a negative offset for oversized objects", () => {
    const oversized = snapshot({ width: 2000, height: 1000 });
    expect(horizontalAlignPatch(oversized, "right")).toEqual({ left: "0px" });
    expect(verticalAlignPatch(oversized, "bottom")).toEqual({ top: "0px" });
  });

  it("reports the alignment the object currently sits at", () => {
    expect(resolveHorizontalAlignment(snapshot())).toBe("left");
    expect(resolveHorizontalAlignment(snapshot({ x: 440 }))).toBe("center");
    expect(resolveHorizontalAlignment(snapshot({ x: 880 }))).toBe("right");
    expect(resolveVerticalAlignment(snapshot({ y: 260 }))).toBe("middle");
    expect(resolveVerticalAlignment(snapshot({ y: 520 }))).toBe("bottom");
  });
});

describe("value formatting", () => {
  it("keeps integers clean and rounds long decimals", () => {
    expect(formatValue(12)).toBe("12");
    expect(formatValue(12.3456)).toBe("12.35");
  });

  it("builds a rotation transform", () => {
    expect(rotationTransform(-45.5)).toBe("rotate(-45.5deg)");
  });
});

describe("slide background parsing", () => {
  it("falls back to the renderer default when unset", () => {
    expect(backgroundCssValue(undefined)).toBe("#000000");
  });

  it("unwraps Tailwind arbitrary values", () => {
    expect(backgroundCssValue("bg-[#123456]")).toBe("#123456");
    expect(backgroundCssValue("bg-[rgb(1_2_3)]")).toBe("rgb(1 2 3)");
  });

  it("reports unreadable backgrounds as null rather than guessing", () => {
    expect(backgroundCssValue("bg-slate-900")).toBeNull();
    expect(backgroundCssValue("bg-gradient-to-r")).toBeNull();
  });

  it("passes raw CSS colors through", () => {
    expect(backgroundCssValue("#abcdef")).toBe("#abcdef");
  });
});
