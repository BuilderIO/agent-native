/**
 * Export fidelity regression spec.
 *
 * Every case here reproduces a REAL defect found by running the Figma export
 * fidelity harness (`scripts/figma-fidelity/run-export.ts`) over the built-in
 * design presets and pixel-diffing the exported SVG against the design's own
 * Chromium render — plus, for the Figma-specific ones, importing that SVG into
 * a real Figma file through the Figma MCP and reading the resulting nodes back.
 * These are not invented edge cases.
 *
 * Harness convergence across the corpus (percentage of differing pixels,
 * threshold 8/255, compared at the artboard's own size):
 *
 * | Case                     | First run | Now     |
 * | ------------------------ | --------- | ------- |
 * | preset-social-square     | 48.364%   | 0.105%  |
 * | preset-display-ad        | 47.032%   | 0.366%  |
 * | preset-one-pager         | 48.450%   | 0.759%  |
 * | preset-landing-page      | 49.341%   | 0.478%  |
 * | effects-transforms       | 41.941%   | 1.897%  |
 * | media-cards              | 22.472%   | 2.180%  |
 * | typography               |  4.161%   | 3.709%  |
 * | layout-stress            |  3.621%   | 0.650%  |
 * | mobile-icons             |  0.853%   | 0.684%  |
 * | whole-screen-padded-body |  4.754%   | 1.765%  |
 *
 * `scripts/figma-fidelity/export-baseline.json` holds a ceiling per case and
 * the harness exits non-zero when one is exceeded, when a baselined case does
 * not run, or when a case reports ANY omission or approximation. Without that
 * gate the harness only printed numbers, so a regression read exactly like a
 * pass.
 *
 * The residual is glyph rasterization: HTML text and SVG `<text>` go through
 * different Chromium paths, so a sub-pixel shift on a glyph edge flips an edge
 * pixel between ink and paper — which is why the residual does NOT fall away at
 * a higher diff threshold the way an antialiasing artifact would. It tracks
 * text density: typography (almost entirely type) is the highest, layout-stress
 * the lowest. `text-rendering="geometricPrecision"` was measured as a possible
 * fix and made every case worse, so Chromium's default is kept. The harness's
 * own noise floor is 0.0000%, and every case reports zero omissions and zero
 * approximations.
 *
 * A separate, real Figma round trip (file K5hsbrwOsZfFkoPuTwk4l3, via
 * `figma.createNodeFromSvg`) took social-square from 5.008% to 3.589%. The rest
 * is Figma's SVG text importer dropping `letter-spacing`, which is measured and
 * documented in FIGMA_INTEROPERABILITY.md and is not fixable from the SVG side:
 * it also ignores `textLength`/`lengthAdjust`, multi-value `tspan x`, sibling
 * `tspan` x, `word-spacing`, and family-encoded weights. Only one `<text>` per
 * glyph places exactly, which would cost editability.
 */
import { describe, expect, it } from "vitest";

import {
  buildFigmaSvgDocument,
  buildFillLayersFromComputedStyle,
  buildLinearGradientDef,
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
    // Chromium's computed `background-image` echoes the authored stop list and
    // does NOT synthesize percentages. Treating a missing position as 0 emitted
    // out-of-order offsets, which browsers clamp up to the previous stop — so
    // this exact gradient rendered as a hard-edged wedge instead of a fade, and
    // was the single largest contributor to a 48% pixel diff.
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
    // SVG 1.1 ignores the alpha channel of stop-color and Figma's importer
    // drops it, so every translucent stop pasted in fully opaque.
    const def = buildRadialGradientDef("rg", [
      { offset: 0, color: "rgba(255, 90, 54, 0.28)" },
      { offset: 1, color: "rgb(0, 0, 0)" },
    ]);
    expect(def).toContain('stop-color="rgb(255, 90, 54)" stop-opacity="0.28"');
  });

  it("fades to transparent through the neighbouring hue, matching CSS premultiplied interpolation", () => {
    // CSS interpolates premultiplied, so a fade to `transparent` keeps its
    // neighbour's colour. SVG interpolates colour and opacity separately, which
    // dragged the fade through black and changed the visible falloff.
    const stops = premultiplyTransparentStops([
      { offset: 0, color: "rgba(255, 90, 54, 0.28)" },
      { offset: 0.3, color: "rgba(0, 0, 0, 0)" },
    ]);
    expect(stops[1].color).toBe("rgba(255, 90, 54, 0)");
  });
});

describe("gradient geometry", () => {
  it("resolves linear gradient endpoints in user space, exact at any aspect ratio", () => {
    // The previous objectBoundingBox + rotate() mapping is only correct on a
    // square box, because that space is non-uniformly scaled.
    // Trig leaves sub-picometre noise; `n()` rounds it away at emission, so
    // compare with the same tolerance the serialized output has.
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
    // `userSpaceOnUse` resolves in the DOCUMENT's coordinate system. Emitting
    // box-relative endpoints made every gradient on an element away from the
    // origin render as a flat band of its last stop — a card scrim at y=183
    // came out uniformly black. The preset corpus missed it because those
    // gradient elements all sat at the frame origin.
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
    // Every radial gradient used to be emitted as a centred circle spanning the
    // bounding box, which moved and resized the blob in the preset backdrops.
    const parsed = parseComputedRadialGradient(
      "radial-gradient(circle at 82% 18%, rgba(255, 90, 54, 0.28), rgba(0, 0, 0, 0) 30%)",
    );
    expect(parsed?.shape).toBe("circle");
    expect(parsed?.position).toEqual({ x: "82%", y: "18%" });
    expect(parsed?.extent).toBe("farthest-corner");

    const geometry = resolveRadialGradientGeometry(parsed!, 1080, 1080);
    expect(geometry.cx).toBeCloseTo(885.6, 1);
    expect(geometry.cy).toBeCloseTo(194.4, 1);
    // farthest corner from (885.6, 194.4) on a 1080 square is (0, 1080).
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
    // Chromium tolerates inline alpha on fill/stroke; Figma's importer does not.
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
    // A conic gradient used to fall through the parser chain and vanish with no
    // trace in the export report.
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
    // Every button, pill, badge and chip is both a box and a text leaf. The
    // hydrator returned kind:"text" and discarded the box paint, so the preset's
    // black "Start free" pill exported as bare text on no background.
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
    // Figma imports NO shadows from SVG: every feDropShadow variant produced an
    // empty effects array, and a composed feMorphology/feGaussianBlur chain was
    // mapped to a LAYER_BLUR that blurs the element itself. A blurred, offset,
    // spread-adjusted copy behind the shape renders the same in a browser and
    // arrives in Figma as a blurred layer in the right place.
    const { svg } = buildFigmaSvgDocument({
      width: 200,
      height: 240,
      root: shadowNode(false),
    });
    expect(svg).not.toContain("feDropShadow");
    expect(svg).not.toContain("feMorphology");
    expect(svg).toContain('<feGaussianBlur stdDeviation="20"/>');
    // Spread grows the geometry: 140x110 inflated by 2, offset down by 12.
    const shadowRect = svg.indexOf('x="28" y="70" width="144" height="114"');
    const cardRect = svg.indexOf('x="30" y="60" width="140" height="110"');
    expect(shadowRect).toBeGreaterThan(-1);
    expect(cardRect).toBeGreaterThan(-1);
    expect(shadowRect).toBeLessThan(cardRect);
    // The shape itself carries no filter.
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
    // The DOM walk only recurses into ELEMENT children, so an element whose
    // direct text sits beside a child used to have that text vanish with no
    // trace — "Search assets" next to an icon, "Home" under a tab glyph,
    // "Overview" beside a count badge, and a headline written `A<br>B` all
    // exported as nothing at all.
    //
    // Children that paint or restyle nothing (a `<br>`, a bare inline span) are
    // folded into the run. Children that carry their own paint stay their own
    // nodes, and the element renders BOTH its text and those children.
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
    // The child is still its own shape, not swallowed into the text run.
    expect(svg).toContain('width="20" height="20"');
    expect(report.omitted).toHaveLength(0);
  });
});

describe("per-side borders", () => {
  it("draws only the edges that exist instead of one box outline", () => {
    // A `border-top: 1px` footer rule was classified "non-uniform" and rendered
    // as a representative side around the WHOLE box — a full rectangle.
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
