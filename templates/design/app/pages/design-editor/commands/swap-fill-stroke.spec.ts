import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runSwapFillStroke } from "./swap-fill-stroke";

function element(
  tagName: string,
  computedStyles: Record<string, string>,
): ElementInfo {
  return {
    tagName,
    computedStyles,
    inlineStyles: {},
  } as unknown as ElementInfo;
}

function swap(selectedElement: ElementInfo) {
  const handleStylesChange = vi.fn();
  runSwapFillStroke({
    canEditDesign: true,
    selectedElement,
    handleStylesChange,
  });
  return handleStylesChange.mock.calls[0]?.[0] as
    | Record<string, string>
    | undefined;
}

describe("runSwapFillStroke", () => {
  it("clears inline opacities so an open path's fill stays unpainted", () => {
    const patch = swap(
      element("path", {
        fill: "none",
        stroke: "rgb(0, 0, 0)",
        strokeWidth: "1px",
        strokeOpacity: "1",
        fillOpacity: "1",
      }),
    );

    expect(patch).toEqual({
      fill: "rgb(0, 0, 0)",
      fillOpacity: "",
      stroke: "none",
      strokeOpacity: "",
    });
  });

  it("carries a partial opacity inside the swapped colour", () => {
    const patch = swap(
      element("path", {
        fill: "rgb(255, 0, 0)",
        fillOpacity: "0.5",
        stroke: "none",
        strokeWidth: "0px",
      }),
    );

    expect(patch?.stroke).toBe("rgba(255, 0, 0, 0.5)");
    expect(patch?.strokeWidth).toBe("1px");
    expect(patch?.strokeOpacity).toBe("");
  });

  it("keeps a gradient's partial opacity, which the value cannot carry", () => {
    const gradient = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
    const patch = swap(
      element("path", {
        fill: gradient,
        fillOpacity: "0.5",
        stroke: "none",
        strokeWidth: "0px",
      }),
    );

    expect(patch?.stroke).toBe(gradient);
    expect(patch?.strokeOpacity).toBe("0.5");
    expect(patch?.fill).toBe("none");
    expect(patch?.fillOpacity).toBe("");
  });

  it("overrides an authored opacity so it cannot multiply the swapped colour", () => {
    const patch = swap(
      element("path", {
        fill: "rgb(255, 0, 0)",
        fillOpacity: "0.5",
        stroke: "rgb(0, 0, 255)",
        strokeWidth: "1px",
        strokeOpacity: "0.25",
      }),
    );

    expect(patch).toEqual({
      fill: "rgba(0, 0, 255, 0.25)",
      fillOpacity: "1",
      stroke: "rgba(255, 0, 0, 0.5)",
      strokeOpacity: "1",
    });
  });

  it("swaps a box's background and border colours", () => {
    const patch = swap(
      element("div", {
        backgroundColor: "rgb(255, 0, 0)",
        borderColor: "rgb(0, 0, 0)",
      }),
    );

    expect(patch).toEqual({
      backgroundColor: "rgb(0, 0, 0)",
      borderColor: "rgb(255, 0, 0)",
    });
  });
});
