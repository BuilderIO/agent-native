import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { copyVisualProperties } from "./copy-properties";

const element: ElementInfo = {
  boundingRect: { x: 80, y: 80, width: 160, height: 100 },
  isFlexChild: false,
  isFlexContainer: false,
  tagName: "div",
  classes: [],
  hasOwnText: false,
  inlineStyles: {},
  computedStyles: {
    backgroundColor: "rgb(34, 197, 94)",
    borderColor: "rgb(20, 83, 45)",
    borderWidth: "2px",
    borderStyle: "solid",
    borderRadius: "12px",
    opacity: "0.8",
    color: "rgb(0, 0, 0)",
    fontFamily: "serif",
    fontSize: "16px",
    fontWeight: "400",
    lineHeight: "normal",
    letterSpacing: "normal",
    textAlign: "start",
    left: "80px",
    width: "160px",
  },
};

describe("copy visual properties", () => {
  it("copies box appearance without typography defaults or geometry", () => {
    expect(copyVisualProperties(element)).toEqual({
      backgroundColor: "rgb(34, 197, 94)",
      borderColor: "rgb(20, 83, 45)",
      borderWidth: "2px",
      borderStyle: "solid",
      borderRadius: "12px",
      opacity: "0.8",
    });
  });
  it("copies computed typography from a text layer including stylesheet styling", () => {
    const styles = copyVisualProperties({
      ...element,
      tagName: "h1",
      hasOwnText: true,
      computedStyles: {
        ...element.computedStyles,
        fontFamily: "Georgia",
        fontSize: "36px",
      },
    });
    expect(styles).toMatchObject({
      color: "rgb(0, 0, 0)",
      fontFamily: "Georgia",
      fontSize: "36px",
      fontWeight: "400",
      lineHeight: "normal",
      letterSpacing: "normal",
      textAlign: "start",
    });
    expect(styles).not.toHaveProperty("left");
    expect(styles).not.toHaveProperty("width");
  });
  it("copies authored typography on an empty container without pinning other defaults", () => {
    const styles = copyVisualProperties({
      ...element,
      inlineStyles: { fontSize: "24px" },
      computedStyles: { ...element.computedStyles, fontSize: "24px" },
    });
    expect(styles.fontSize).toBe("24px");
    expect(styles).not.toHaveProperty("fontFamily");
    expect(styles).not.toHaveProperty("color");
  });
});
