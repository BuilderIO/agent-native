import { describe, expect, it } from "vitest";

import {
  buildFigmaSvgDocument,
  buildFillLayersFromComputedStyle,
  hydrateRawFigmaSvgNode,
  splitBorderAreaLayer,
} from "./figma-svg-scene";

const STROKE = "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)";

describe("gradient stroke export", () => {
  it("takes the border-area layer out of the fills", () => {
    expect(
      splitBorderAreaLayer({
        backgroundImage: `${STROKE}, none`,
        backgroundSize: "100% 100%, auto",
        backgroundPosition: "0% 0%, 0% 0%",
        backgroundRepeat: "no-repeat, repeat",
        backgroundClip: "border-area, border-box",
      }),
    ).toEqual({
      backgroundImage: "none",
      backgroundSize: "auto",
      backgroundPosition: "0% 0%",
      backgroundRepeat: "repeat",
      borderPaintImage: STROKE,
    });
  });

  it("draws the border with the gradient instead of a fill", () => {
    const paint = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      STROKE,
    )[0];
    const { svg } = buildFigmaSvgDocument({
      width: 100,
      height: 100,
      root: {
        id: "box",
        kind: "box",
        rect: { x: 0, y: 0, width: 100, height: 100 },
        fills: [{ kind: "solid", color: "rgb(217, 217, 217)" }],
        border: { widthPx: 8, color: "rgba(0, 0, 0, 0)", paint },
      },
    });
    expect(svg).toMatch(/fill="none" stroke="url\(#lg-\d+\)" stroke-width="8"/);
    expect(svg).toContain("<linearGradient");
  });

  it("hydrates a captured border-area layer into the border paint", () => {
    const node = hydrateRawFigmaSvgNode({
      id: "box",
      domTag: "DIV",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      opacity: 1,
      cornerRadiiRaw: { tl: 0, tr: 0, br: 0, bl: 0 },
      backgroundColor: "rgb(217, 217, 217)",
      backgroundImage: `${STROKE}, none`,
      backgroundSize: "100% 100%, auto",
      backgroundPosition: "0% 0%, 0% 0%",
      backgroundRepeat: "no-repeat, repeat",
      backgroundClip: "border-area, border-box",
      boxShadow: "none",
      borderWidthPx: 8,
      borderColor: "rgba(0, 0, 0, 0)",
      borderStyle: "solid",
      borderNonUniform: false,
      backdropFilter: "none",
      filter: "none",
      mixBlendMode: "normal",
      children: [],
    } as unknown as Parameters<typeof hydrateRawFigmaSvgNode>[0]);
    expect(node.fills).toEqual([
      { kind: "solid", color: "rgba(217, 217, 217, 1)" },
    ]);
    expect(node.border?.paint).toMatchObject({ kind: "linear-gradient" });
  });
});
