// The Figma/SVG exporters carry sRGB only. A design can now hold oklch() and
// color(display-p3 ...) colors, and an exporter that meets one must DEGRADE
// EXPLICITLY: the CSS Color 4 gamut-mapped sRGB fallback, never a throw, never
// invalid CSS, never a pass-through the target cannot read.
//
// Reference fallbacks (culori 4.0.2, CSS Color 4 gamut mapping):
//   oklch(0.7 0.3 150)        -> rgb(0, 194, 72)   (#00c248)
//   color(display-p3 1 0 0)   -> rgb(255, 11, 12)  (#ff0b0c)
import { describe, expect, it } from "vitest";

import { buildFigmaNodeSpec } from "./figma-node-spec.js";
import {
  buildLinearGradientDef,
  paintAttributes,
  parseComputedLinearGradient,
  premultiplyTransparentStops,
  type FigmaSvgLayoutFacts,
  type FigmaSvgNode,
} from "./figma-svg-scene.js";

const layout: FigmaSvgLayoutFacts = {
  display: "block",
  flexDirection: "row",
  flexWrap: "nowrap",
  justifyContent: "normal",
  alignItems: "normal",
  rowGapPx: 0,
  columnGapPx: 0,
  paddingPx: [0, 0, 0, 0],
  position: "static",
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: "auto",
  alignSelf: "auto",
};

function boxWithFill(color: string): FigmaSvgNode {
  return {
    id: "b",
    name: "b",
    kind: "box",
    rect: { x: 0, y: 0, width: 100, height: 100 },
    layout,
    children: [],
    fills: [{ kind: "solid", color }],
  };
}

describe("SVG paint attributes", () => {
  it("writes the sRGB fallback of an oklch() fill, not the oklch() string", () => {
    expect(paintAttributes("fill", "oklch(0.7 0.3 150)")).toBe(
      'fill="rgb(0, 194, 72)"',
    );
  });

  it("writes the sRGB fallback of a Display P3 stroke and keeps its alpha as stroke-opacity", () => {
    expect(paintAttributes("stroke", "color(display-p3 1 0 0 / 0.5)")).toBe(
      'stroke="rgb(255, 11, 12)" stroke-opacity="0.5"',
    );
  });

  it("emits nothing a viewer would have to parse as a wide color", () => {
    for (const color of [
      "oklch(0.7 0.3 150)",
      "color(display-p3 0 1 0)",
      "color(srgb 1 0.2 0)",
    ]) {
      expect(paintAttributes("fill", color)).toMatch(
        /^fill="rgb\(\d+, \d+, \d+\)"$/,
      );
    }
  });
});

describe("SVG gradient stops", () => {
  const gradient =
    "linear-gradient(90deg, oklch(0.7 0.3 150) 0%, color(display-p3 1 0 0 / 50%) 100%)";

  it("reads stops whose colors are wide-gamut", () => {
    const parsed = parseComputedLinearGradient(gradient);
    expect(parsed?.stops.map((stop) => stop.color)).toEqual([
      "oklch(0.7 0.3 150)",
      "color(display-p3 1 0 0 / 50%)",
    ]);
    expect(parsed?.stops.map((stop) => stop.offset)).toEqual([0, 1]);
  });

  it("writes each stop as its sRGB fallback with stop-opacity", () => {
    const stops = parseComputedLinearGradient(gradient)!.stops;
    const def = buildLinearGradientDef("g", 90, stops, {
      width: 100,
      height: 50,
    });
    expect(def).toContain('stop-color="rgb(0, 194, 72)"');
    expect(def).toContain('stop-color="rgb(255, 11, 12)" stop-opacity="0.5"');
    expect(def).not.toMatch(/oklch|display-p3/);
  });

  it("gives a transparent wide stop its neighbour's fallback color", () => {
    const stops = premultiplyTransparentStops([
      { offset: 0, color: "oklch(0.7 0.3 150)" },
      { offset: 1, color: "color(display-p3 1 0 0 / 0)" },
    ]);
    expect(stops[1]?.color).toBe("rgba(0, 194, 72, 0)");
  });
});

describe("Figma node spec", () => {
  it("fills a node with the sRGB fallback of an oklch() color", () => {
    const { root } = buildFigmaNodeSpec(boxWithFill("oklch(0.7 0.3 150)"));
    const paint = root.fills?.[0];
    expect(paint).toMatchObject({ type: "SOLID", opacity: 1 });
    const color = (paint as { color: { r: number; g: number; b: number } })
      .color;
    expect(color.r).toBeCloseTo(0, 6);
    expect(color.g).toBeCloseTo(194 / 255, 6);
    expect(color.b).toBeCloseTo(72 / 255, 6);
  });

  it("keeps a Display P3 fill's alpha as paint opacity", () => {
    const { root } = buildFigmaNodeSpec(
      boxWithFill("color(display-p3 1 0 0 / 0.25)"),
    );
    expect(root.fills?.[0]).toMatchObject({ type: "SOLID", opacity: 0.25 });
  });

  it("does not throw on a malformed wide color and does not invent a fill for it", () => {
    expect(() => buildFigmaNodeSpec(boxWithFill("oklch(0.7)"))).not.toThrow();
    const { root } = buildFigmaNodeSpec(boxWithFill("oklch(0.7)"));
    expect(root.fills).toBeUndefined();
  });
});
