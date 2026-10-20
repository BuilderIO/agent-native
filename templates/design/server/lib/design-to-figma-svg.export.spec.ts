import { describe, expect, it } from "vitest";

import {
  buildFigmaSvgDocument,
  buildFillLayersFromComputedStyle,
  buildLinearGradientDef,
  isUniformRadius,
  roundedRectPath,
  buildRadialGradientDef,
  linearGradientEndpoints,
  normalizeStopOffsets,
  paintAttributes,
  parseComputedLinearGradient,
  parseComputedRadialGradient,
  premultiplyTransparentStops,
  resolveRadialGradientGeometry,
  type FigmaSvgNode,
} from "./design-to-figma-svg.js";

describe("gradient stop positions", () => {
  it("gives an unpositioned trailing stop offset 1, not 0", () => {
    const parsed = parseComputedLinearGradient(
      "linear-gradient(145deg, rgba(0, 0, 0, 0) 55%, rgba(17, 17, 15, 0.07))",
    );
    expect(parsed?.stops.map((s) => s.offset)).toEqual([0.55, 1]);
  });

  it("spreads a run of unpositioned stops evenly between positioned neighbours", () => {
    const stops = normalizeStopOffsets([
      { offset: 0, color: "red" },
      { offset: null, color: "green" },
      { offset: null, color: "blue" },
      { offset: 1, color: "black" },
    ]);
    expect(stops.map((s) => s.offset)).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it("clamps a decreasing stop position to its predecessor", () => {
    const stops = normalizeStopOffsets([
      { offset: 0.8, color: "red" },
      { offset: 0.2, color: "blue" },
    ]);
    expect(stops.map((s) => s.offset)).toEqual([0.8, 0.8]);
  });

  it("carries stop alpha in stop-opacity rather than the stop-color channel", () => {
    const def = buildRadialGradientDef("rg", [
      { offset: 0, color: "rgba(255, 90, 54, 0.28)" },
      { offset: 1, color: "rgb(0, 0, 0)" },
    ]);
    expect(def).toContain('stop-color="rgb(255, 90, 54)" stop-opacity="0.28"');
  });

  it("fades to transparent through the neighbouring hue, matching CSS premultiplied interpolation", () => {
    const stops = premultiplyTransparentStops([
      { offset: 0, color: "rgba(255, 90, 54, 0.28)" },
      { offset: 0.3, color: "rgba(0, 0, 0, 0)" },
    ]);
    expect(stops[1].color).toBe("rgba(255, 90, 54, 0)");
  });
});

describe("gradient geometry", () => {
  it("resolves linear gradient endpoints in user space, exact at any aspect ratio", () => {
    const across = linearGradientEndpoints(90, 400, 100);
    expect(across.x1).toBeCloseTo(0, 6);
    expect(across.y1).toBeCloseTo(50, 6);
    expect(across.x2).toBeCloseTo(400, 6);
    expect(across.y2).toBeCloseTo(50, 6);

    const down = linearGradientEndpoints(180, 400, 100);
    expect(down.x1).toBeCloseTo(200, 6);
    expect(down.y1).toBeCloseTo(0, 6);
    expect(down.x2).toBeCloseTo(200, 6);
    expect(down.y2).toBeCloseTo(100, 6);
  });

  it("emits userSpaceOnUse endpoints when the box size is known", () => {
    const def = buildLinearGradientDef(
      "lg",
      90,
      [
        { offset: 0, color: "rgb(255, 0, 0)" },
        { offset: 1, color: "rgb(0, 0, 255)" },
      ],
      { width: 400, height: 100 },
    );
    expect(def).toContain('gradientUnits="userSpaceOnUse"');
    expect(def).toContain('x1="0" y1="50" x2="400" y2="50"');
  });

  it("translates userSpaceOnUse endpoints to where the box actually sits", () => {
    const def = buildLinearGradientDef(
      "lg",
      180,
      [
        { offset: 0, color: "rgba(0, 0, 0, 0)" },
        { offset: 1, color: "rgba(0, 0, 0, 0.72)" },
      ],
      { x: 49, y: 183, width: 350, height: 190 },
    );
    expect(def).toContain('x1="224" y1="183" x2="224" y2="373"');
  });

  it("keeps an off-centre radial gradient's position and extent", () => {
    const parsed = parseComputedRadialGradient(
      "radial-gradient(circle at 82% 18%, rgba(255, 90, 54, 0.28), rgba(0, 0, 0, 0) 30%)",
    );
    expect(parsed?.shape).toBe("circle");
    expect(parsed?.position).toEqual({ x: "82%", y: "18%" });
    expect(parsed?.extent).toBe("farthest-corner");

    const geometry = resolveRadialGradientGeometry(parsed!, 1080, 1080);
    expect(geometry.cx).toBeCloseTo(885.6, 1);
    expect(geometry.cy).toBeCloseTo(194.4, 1);
    expect(geometry.rx).toBeCloseTo(Math.hypot(885.6, 885.6), 1);
    expect(geometry.rx).toBeCloseTo(geometry.ry, 6);
  });

  it("sizes closest-side and farthest-side circles from the right edges", () => {
    const base = parseComputedRadialGradient(
      "radial-gradient(circle closest-side at 25% 50%, red, blue)",
    )!;
    expect(resolveRadialGradientGeometry(base, 400, 200).rx).toBe(100);
    expect(
      resolveRadialGradientGeometry(
        { ...base, extent: "farthest-side" },
        400,
        200,
      ).rx,
    ).toBe(300);
  });
});

describe("paint attributes", () => {
  it("splits fill and stroke alpha into a separate opacity attribute", () => {
    expect(paintAttributes("fill", "rgba(17, 17, 15, 0.66)")).toBe(
      'fill="rgb(17, 17, 15)" fill-opacity="0.66"',
    );
    expect(paintAttributes("stroke", "rgba(17, 17, 15, 0.14)")).toBe(
      'stroke="rgb(17, 17, 15)" stroke-opacity="0.14"',
    );
  });

  it("passes paint references and none through untouched", () => {
    expect(paintAttributes("fill", "url(#lg-1)")).toBe('fill="url(#lg-1)"');
    expect(paintAttributes("fill", "none")).toBe('fill="none"');
  });

  it("omits the opacity attribute for a fully opaque colour", () => {
    expect(paintAttributes("fill", "rgb(17, 17, 15)")).toBe(
      'fill="rgb(17, 17, 15)"',
    );
  });
});

describe("background layers", () => {
  it("reports a background layer with no SVG equivalent instead of dropping it", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      "conic-gradient(from 45deg, rgb(255, 0, 0), rgb(0, 0, 255))",
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].kind).toBe("unsupported");

    const root: FigmaSvgNode = {
      id: "root",
      name: "Backdrop",
      kind: "box",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      fills: layers,
    };
    const { report } = buildFigmaSvgDocument({ width: 100, height: 100, root });
    expect(report.omitted.some((o) => o.node === "Backdrop")).toBe(true);
  });
});

describe("text leaves that are also boxes", () => {
  it("paints a text node's own background, border and radius beneath the glyphs", () => {
    const root: FigmaSvgNode = {
      id: "cta",
      name: "CTA",
      kind: "text",
      rect: { x: 0, y: 0, width: 120, height: 48 },
      cornerRadii: { tl: 24, tr: 24, br: 24, bl: 24 },
      fills: [{ kind: "solid", color: "rgb(17, 17, 15)" }],
      text: {
        lines: [{ text: "Start free", x: 22, y: 24 }],
        style: {
          fontFamily: "Inter",
          fontSizePx: 14,
          fontWeight: 700,
          italic: false,
          letterSpacingPx: 0,
          color: "rgb(255, 255, 255)",
          textAlign: "left",
        },
      },
    };
    const { svg } = buildFigmaSvgDocument({ width: 120, height: 48, root });
    expect(svg).toContain('fill="rgb(17, 17, 15)"');
    expect(svg.indexOf('fill="rgb(17, 17, 15)"')).toBeLessThan(
      svg.indexOf("<text"),
    );
    expect(svg).toContain("Start free");
  });
});

describe("shadows", () => {
  const shadowNode = (inset: boolean): FigmaSvgNode => ({
    id: "card",
    name: "Card",
    kind: "box",
    rect: { x: 30, y: 60, width: 140, height: 110 },
    cornerRadii: { tl: 16, tr: 16, br: 16, bl: 16 },
    fills: [{ kind: "solid", color: "rgb(255, 255, 255)" }],
    shadows: [
      {
        offsetX: 0,
        offsetY: 12,
        blur: 40,
        spread: inset ? 0 : 2,
        color: "rgba(24, 24, 27, 0.35)",
        inset,
      },
    ],
  });

  it("paints a drop shadow as blurred geometry behind the shape, not a filter on it", () => {
    const { svg } = buildFigmaSvgDocument({
      width: 200,
      height: 240,
      root: shadowNode(false),
    });
    expect(svg).not.toContain("feDropShadow");
    expect(svg).not.toContain("feMorphology");
    expect(svg).toContain('<feGaussianBlur stdDeviation="20"/>');
    const shadowRect = svg.indexOf('x="28" y="70" width="144" height="114"');
    const cardRect = svg.indexOf('x="30" y="60" width="140" height="110"');
    expect(shadowRect).toBeGreaterThan(-1);
    expect(cardRect).toBeGreaterThan(-1);
    expect(shadowRect).toBeLessThan(cardRect);
    expect(svg.slice(cardRect, cardRect + 160)).not.toContain("filter=");
  });

  it("paints an inset shadow as an inverted ring clipped back to the shape", () => {
    const { svg } = buildFigmaSvgDocument({
      width: 200,
      height: 240,
      root: shadowNode(true),
    });
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain("<clipPath");
    expect(svg).toContain('<feGaussianBlur stdDeviation="20"/>');
  });

  it("reports no approximation for either shadow kind", () => {
    for (const inset of [false, true]) {
      const { report } = buildFigmaSvgDocument({
        width: 200,
        height: 240,
        root: shadowNode(inset),
      });
      expect(report.approximated).toHaveLength(0);
      expect(report.omitted).toHaveLength(0);
    }
  });
});

describe("text with inline children", () => {
  it("exports an element's own text alongside children that must stay separate", () => {
    const root: FigmaSvgNode = {
      id: "tab",
      name: "Tab",
      kind: "box",
      rect: { x: 0, y: 0, width: 90, height: 60 },
      children: [
        {
          id: "icon",
          name: "Icon",
          kind: "box",
          rect: { x: 35, y: 8, width: 20, height: 20 },
          fills: [{ kind: "solid", color: "rgb(165, 180, 252)" }],
        },
      ],
      text: {
        lines: [{ text: "HOME", x: 45, y: 46 }],
        style: {
          fontFamily: "Inter",
          fontSizePx: 10,
          fontWeight: 700,
          italic: false,
          letterSpacingPx: 0.8,
          color: "rgb(165, 180, 252)",
          textAlign: "center",
        },
      },
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 90,
      height: 60,
      root,
    });
    expect(svg).toContain("HOME");
    expect(svg).toContain('width="20" height="20"');
    expect(report.omitted).toHaveLength(0);
  });
});

describe("per-side borders", () => {
  it("draws only the edges that exist instead of one box outline", () => {
    const root: FigmaSvgNode = {
      id: "footer",
      name: "Footer",
      kind: "box",
      rect: { x: 0, y: 0, width: 400, height: 100 },
      border: {
        widthPx: 1,
        color: "rgba(17, 17, 15, 0.14)",
        dashed: false,
        nonUniform: true,
        sides: [
          { widthPx: 1, color: "rgba(17, 17, 15, 0.14)", dashed: false },
          null,
          null,
          null,
        ],
      },
    };
    const { svg } = buildFigmaSvgDocument({ width: 400, height: 100, root });
    const lines = svg.match(/<line /g) ?? [];
    expect(lines).toHaveLength(1);
    expect(svg).toContain('x1="0" y1="0.5" x2="400" y2="0.5"');
    expect(svg).toContain('stroke-opacity="0.14"');
  });
});

describe("full ellipses in the exported SVG", () => {
  it("draws a circle, not a rounded square", () => {
    const d = roundedRectPath(
      { x: 0, y: 0, width: 125, height: 125 },
      { tl: 62.5, tr: 62.5, br: 62.5, bl: 62.5, ellipse: true },
    );
    expect(d).toContain("A 62.5 62.5");
    expect(d).not.toContain("L ");
  });

  it("keeps rx and ry independent for a non-square ellipse", () => {
    const d = roundedRectPath(
      { x: 0, y: 0, width: 338, height: 71 },
      { tl: 169, tr: 169, br: 169, bl: 169, ellipse: true },
    );
    expect(d).toContain("A 169 35.5");
  });

  it("still draws a rounded rectangle when the radii are not a full ellipse", () => {
    const d = roundedRectPath(
      { x: 0, y: 0, width: 200, height: 100 },
      { tl: 10, tr: 10, br: 10, bl: 10 },
    );
    expect(d).toContain("A 10 10");
    expect(d).toContain("L ");
  });

  it("never takes the uniform-rect shortcut for an ellipse", () => {
    expect(
      isUniformRadius({ tl: 169, tr: 169, br: 169, bl: 169, ellipse: true }),
    ).toBe(false);
    expect(isUniformRadius({ tl: 10, tr: 10, br: 10, bl: 10 })).toBe(true);
  });
});

describe("image fills the exporter cannot resolve", () => {
  const withHref = (href: string) => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Hero",
      kind: "box",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ kind: "image", href, fit: "cover" }],
    };
    return buildFigmaSvgDocument({ width: 100, height: 100, root });
  };

  it("omits and reports an unresolvable href instead of exporting a broken <image>", () => {
    const { svg, report } = withHref("about:blank");
    expect(svg).not.toContain("<image");
    expect(report.omitted.some((o) => o.node === "Hero")).toBe(true);
    expect(
      report.omitted.some((o) => o.reason.includes("no resolvable source")),
    ).toBe(true);
  });

  it("still exports a real data: source", () => {
    const { svg, report } = withHref("data:image/png;base64,AAA");
    expect(svg).toContain("<image");
    expect(report.omitted).toHaveLength(0);
  });

  it("still exports a real https: source", () => {
    const { svg } = withHref("https://example.com/hero.png");
    expect(svg).toContain("<image");
  });
});
