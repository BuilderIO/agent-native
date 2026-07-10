import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import {
  constraintsStylePatch,
  definiteAuthoredOffset,
  deriveConstraintsValue,
} from "./position-layout-properties";

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 50 },
    parentBoundingRect: { x: 0, y: 0, width: 400, height: 200 },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  } as ElementInfo;
}

describe("definiteAuthoredOffset", () => {
  it("passes through a real authored offset", () => {
    expect(definiteAuthoredOffset("120px")).toBe("120px");
  });

  it("treats the CSS default 'auto' as unset", () => {
    expect(definiteAuthoredOffset("auto")).toBeUndefined();
  });

  it("treats the Mixed sentinel as unset", () => {
    expect(definiteAuthoredOffset("Mixed")).toBeUndefined();
  });

  it("treats an empty string or undefined as unset", () => {
    expect(definiteAuthoredOffset("")).toBeUndefined();
    expect(definiteAuthoredOffset(undefined)).toBeUndefined();
  });
});

describe("deriveConstraintsValue", () => {
  it("reads a plain, never-repositioned element as anchored left/top, not left-right/top-bottom", () => {
    // No inlineStyles at all (the common case for an ordinary element that
    // was never explicitly given left/right/top/bottom) — authoredStyleValue
    // falls back to computedStyles, and getComputedStyle reports "auto" for
    // an unpositioned element's left/right/top/bottom. Before the
    // definiteAuthoredOffset guard, "auto" && "auto" read as truthy and this
    // rendered as pinned to both edges on every ordinary element.
    const value = deriveConstraintsValue(
      element({
        computedStyles: {
          left: "auto",
          right: "auto",
          top: "auto",
          bottom: "auto",
          width: "100px",
          height: "50px",
        },
      }),
    );
    expect(value).toEqual({ horizontal: "left", vertical: "top" });
  });

  it("reads an explicitly authored left+right as left-right", () => {
    const value = deriveConstraintsValue(
      element({
        inlineStyles: { left: "10px", right: "10px" },
        computedStyles: {
          left: "10px",
          right: "10px",
          top: "auto",
          bottom: "auto",
        },
      }),
    );
    expect(value.horizontal).toBe("left-right");
  });

  it("does not mistake a computed opposite edge for an authored pin", () => {
    const value = deriveConstraintsValue(
      element({
        inlineStyles: { left: "40px", top: "20px", width: "120px" },
        computedStyles: {
          left: "40px",
          right: "240px",
          top: "20px",
          bottom: "240px",
          width: "120px",
        },
      }),
    );
    expect(value).toEqual({ horizontal: "left", vertical: "top" });
  });

  it("reads an explicitly authored right-only pin as right", () => {
    const value = deriveConstraintsValue(
      element({
        inlineStyles: { right: "0px" },
        computedStyles: { left: "auto", right: "0px" },
      }),
    );
    expect(value.horizontal).toBe("right");
  });

  it("reads width:100% as scale regardless of left/right", () => {
    const value = deriveConstraintsValue(
      element({
        computedStyles: { width: "100%", left: "auto", right: "auto" },
      }),
    );
    expect(value.horizontal).toBe("scale");
  });

  it("reports a cross-selection Mixed horizontal axis honestly", () => {
    const value = deriveConstraintsValue(
      element({
        computedStyles: { left: "Mixed", right: "Mixed" },
      }),
    );
    expect(value.horizontal).toBe("mixed");
    expect(value.vertical).toBe("top");
  });

  it("reports transform-dependent axes as Mixed when transforms differ", () => {
    expect(
      deriveConstraintsValue(
        element({ computedStyles: { transform: "Mixed" } }),
      ),
    ).toEqual({ horizontal: "mixed", vertical: "mixed" });
  });
});

describe("constraintsStylePatch", () => {
  it("builds one complete centered constraints patch", () => {
    expect(
      constraintsStylePatch(
        element({
          computedStyles: { transform: "rotate(15deg)" },
          boundingRect: { x: 20, y: 30, width: 100, height: 50 },
          parentBoundingRect: { x: 0, y: 0, width: 400, height: 200 },
        }),
        { horizontal: "center", vertical: "center" },
      ),
    ).toEqual({
      position: "absolute",
      left: "calc(50% + -130px)",
      right: "auto",
      width: "100px",
      top: "calc(50% + -45px)",
      bottom: "auto",
      height: "50px",
      transform: "translateY(-50%) translateX(-50%) rotate(15deg)",
    });
  });

  it("leaves a mixed axis entirely untouched when the other axis changes", () => {
    expect(
      constraintsStylePatch(
        element({
          inlineStyles: { left: "Mixed", right: "Mixed", top: "12px" },
          computedStyles: { transform: "none" },
        }),
        { horizontal: "mixed", vertical: "bottom" },
      ),
    ).toEqual({
      position: "absolute",
      bottom: "150px",
      top: "auto",
      height: "50px",
      transform: "none",
    });
  });

  it("falls back to the current canvas coordinates without ever writing auto or Mixed as a pin", () => {
    expect(
      constraintsStylePatch(
        element({
          inlineStyles: { left: "Mixed", top: "auto" },
          boundingRect: { x: 20.4, y: 30.6, width: 100, height: 50 },
        }),
        { horizontal: "left", vertical: "mixed" },
      ),
    ).toMatchObject({ left: "20.4px" });
  });

  it("writes proportional position and size for Scale on both axes", () => {
    expect(
      constraintsStylePatch(
        element({
          computedStyles: { transform: "rotate(12deg)" },
          boundingRect: { x: 140, y: 90, width: 120, height: 60 },
          parentBoundingRect: { x: 100, y: 50, width: 400, height: 200 },
        }),
        { horizontal: "scale", vertical: "scale" },
      ),
    ).toEqual({
      position: "absolute",
      left: "10%",
      right: "auto",
      width: "30%",
      top: "20%",
      bottom: "auto",
      height: "30%",
      transform: "rotate(12deg)",
    });
  });

  it("preserves current right/bottom gaps instead of snapping to zero", () => {
    expect(
      constraintsStylePatch(
        element({
          boundingRect: { x: 140, y: 90, width: 120, height: 60 },
          parentBoundingRect: { x: 100, y: 50, width: 400, height: 200 },
        }),
        { horizontal: "right", vertical: "bottom" },
      ),
    ).toMatchObject({
      left: "auto",
      right: "240px",
      width: "120px",
      top: "auto",
      bottom: "100px",
      height: "60px",
    });
  });

  it("pins both edges and releases fixed size for stretch constraints", () => {
    expect(
      constraintsStylePatch(
        element({
          boundingRect: { x: 140, y: 90, width: 120, height: 60 },
          parentBoundingRect: { x: 100, y: 50, width: 400, height: 200 },
        }),
        { horizontal: "left-right", vertical: "top-bottom" },
      ),
    ).toMatchObject({
      left: "40px",
      right: "240px",
      width: "auto",
      top: "40px",
      bottom: "100px",
      height: "auto",
    });
  });

  it("does not rewrite the unchanged opposite axis and preserves its transform", () => {
    expect(
      constraintsStylePatch(
        element({
          inlineStyles: {
            top: "50%",
            height: "50px",
            transform: "translateY(-50%) rotate(8deg)",
          },
          computedStyles: {
            left: "20px",
            top: "50%",
            width: "100px",
            height: "50px",
            transform: "translateY(-50%) rotate(8deg)",
          },
          boundingRect: { x: 20, y: 75, width: 100, height: 50 },
        }),
        { horizontal: "scale", vertical: "center" },
      ),
    ).toEqual({
      position: "absolute",
      left: "5%",
      right: "auto",
      width: "25%",
      transform: "translateY(-50%) rotate(8deg)",
    });
  });
});
