import { describe, expect, it } from "vitest";

import type { ElementInfo } from "../types";
import {
  definiteAuthoredOffset,
  deriveConstraintsValue,
} from "./position-layout-properties";

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 50 },
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

  it("does not misread a cross-selection Mixed left/right as left-right", () => {
    const value = deriveConstraintsValue(
      element({
        computedStyles: { left: "Mixed", right: "Mixed" },
      }),
    );
    expect(value.horizontal).toBe("left");
  });
});
