/**
 * Complexity-corpus fidelity regression spec.
 *
 * Every case here reproduces a REAL bug found by importing a deliberately
 * adversarial Figma corpus (deep nested/wrapped auto-layout, dense mixed
 * typography, a full fills/effects stack including all 4 gradient types,
 * per-corner radii + rotated nested frames + stroke-alignment variants, a
 * real Figma component instantiated 6x, and absolute-positioned overlapping
 * children) through the actual REST -> `mapFigmaNodeToHtml` ->
 * screenshot-diff pipeline, NOT invented edge cases. Each `it()` pins the
 * fix with the smallest node JSON that reproduces it so a future change
 * can't silently regress it.
 *
 * Corpus provenance: Figma file 4HW2pnM03TFDIXxyym5Qcd ("AN Interop Fixture
 * F3b"), page "Page 1", top-level frames 4:2 (auto-layout), 4:90
 * (typography), 4:99 (fills/effects), 4:42 (shapes), 4:53 (card grid
 * component+instances), 4:83 (constraints/absolute mix), all built live via
 * the Figma Plugin API MCP, then read back through the real REST
 * `/v1/files/:key/nodes` + `/v1/images/:key` endpoints.
 *
 * Pixel-diff convergence (REST @2x render vs the real mapper's HTML
 * screenshotted at deviceScaleFactor 2, pixelmatch threshold 0.1,
 * includeAA:false -- see scratchpad/w2-corpus/converge.mjs for the harness):
 *
 * | Fixture              | Stresses                                             | First import | After fixes |
 * | --------------------- | ----------------------------------------------------- | ------------ | ------------ |
 * | A-autolayout (4:2)     | 5-level nested/wrapped auto-layout, mixed align/grow  | 1.658%       | 0.843%       |
 * | B-typography (4:90)    | 8 mixed text nodes, line-height/decoration/truncation | 11.061%      | 2.328%       |
 * | C-fills-effects (4:99) | multi-fill stack, all 4 gradients, shadows, blur, blend| 15.579%     | 9.118%       |
 * | D-shapes (4:42)        | per-corner radii, rotated frame, stroke aligns, star/polygon | 4.429% | 2.517%       |
 * | E-card-grid (4:53)     | real component + 6 instances w/ overrides             | 2.984%       | 0.711%       |
 * | F-constraints (4:83)   | absolute badge/ribbon overlapping auto-layout, rotation | 3.179%      | 1.347%       |
 *
 * Remaining residual in C is concentrated in two cells that are documented,
 * accepted CSS-expressiveness limits, not further-fixable bugs: a 16x16
 * hard-edged checkerboard image fill (Chromium's `background-size: cover`
 * resampling vs Figma's own rasterizer disagree pixel-for-pixel on tiny hard
 * edges -- real photos with smooth gradients don't show this), and the
 * GRADIENT_DIAMOND ellipse approximation (no CSS diamond-gradient exists;
 * already called out in this module's doc comment). B's residual is mostly
 * Figma-vs-Chromium sub-pixel text-rendering/hinting noise on dense
 * multi-line paragraphs, not a structural mapping bug.
 */
import { describe, expect, it } from "vitest";

import {
  buildGoogleFontsUrl,
  withFigmaFontLoading,
} from "./figma-node-import.js";
import {
  collectFallbackNodeIds,
  collectFontUsage,
  gradientAngleDegrees,
  mapFigmaNodeToHtml,
  type FigmaNode,
  type FigmaPaint,
} from "./figma-node-to-html.js";

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

describe("lineTypes false-positive fallback (bug: ordinary text always fell back)", () => {
  it("does NOT fall back ordinary multi-line text where every line is lineTypes=NONE", () => {
    // Figma's REST API always returns one lineTypes entry per line -- plain
    // non-list text comes back as ["NONE", "NONE", ...], never `[]`. Before
    // the fix, `(node.lineTypes?.length ?? 0) > 0` treated ANY multi-line
    // text node in existence as an unsupported list and routed it to an
    // image fallback -- this reproduced on literally every text node in the
    // real B-typography (8/8) and E-card-grid (multiple) corpus fixtures.
    const textNode: FigmaNode = {
      id: "para",
      type: "TEXT",
      characters: "Line one\nLine two\nLine three",
      style: { fontFamily: "Inter", fontSize: 16 },
      lineTypes: ["NONE", "NONE", "NONE"],
      lineIndentations: [0, 0, 0],
      absoluteBoundingBox: box(10, 10, 200, 60),
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 220, 80),
      children: [textNode],
    };
    const ids = collectFallbackNodeIds(root);
    expect(ids).not.toContain("para");
    const { html, fidelity } = mapFigmaNodeToHtml(root);
    expect(html).toContain("Line one");
    const entry = fidelity.entries.find((e) => e.nodeId === "para");
    expect(entry?.level).not.toBe("image-fallback");
  });

  it("still falls back real list text (some lineTypes entry is not NONE)", () => {
    const textNode: FigmaNode = {
      id: "list",
      type: "TEXT",
      characters: "One\nTwo",
      style: { fontFamily: "Inter", fontSize: 16 },
      lineTypes: ["ORDERED", "ORDERED"],
      absoluteBoundingBox: box(10, 10, 200, 60),
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 220, 80),
      children: [textNode],
    };
    expect(collectFallbackNodeIds(root)).toContain("list");
  });
});

describe("radial/diamond gradient axis mapping (bug: radiusX/radiusY swapped)", () => {
  // Handle[1] ("end") is Figma's primary-axis radius vector; handle[2]
  // ("width") is the perpendicular radius. A prior version of this code
  // assigned them backwards, which is invisible on a square box but rotates
  // the rendered ellipse 90 degrees on any non-square rectangle -- exactly
  // what the real C-fills-effects "Radial Gradient" node (180x90) hit: a
  // wide horizontal radial glow rendered as a narrow vertical bowtie.
  function radialPaint(): FigmaPaint {
    return {
      type: "GRADIENT_RADIAL",
      gradientHandlePositions: [
        { x: 0.5, y: 0.5 }, // center
        { x: 1.5, y: 0.5 }, // +1 unit horizontal -> should become radiusX
        { x: 0.5, y: 1.5 }, // +1 unit vertical -> should become radiusY
      ],
      gradientStops: [
        { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    };
  }

  it("maps the horizontal handle to radiusX and vertical handle to radiusY for a wide box", () => {
    const node: FigmaNode = {
      id: "radial",
      type: "RECTANGLE",
      fills: [radialPaint()],
      absoluteBoundingBox: box(0, 0, 180, 90),
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 180, 90),
      children: [node],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const match = html.match(/radial-gradient\(ellipse ([\d.]+)px ([\d.]+)px/);
    expect(match).not.toBeNull();
    const [, radiusXStr, radiusYStr] = match!;
    const radiusX = Number(radiusXStr);
    const radiusY = Number(radiusYStr);
    // The horizontal handle spans the full 180px width -> radiusX must be
    // the LARGER of the two (matching the box's own aspect ratio), never
    // the smaller (which is what the swapped-axis bug produced).
    expect(radiusX).toBeGreaterThan(radiusY);
    expect(radiusX).toBeCloseTo(180, 0);
    expect(radiusY).toBeCloseTo(90, 0);
  });

  it("applies the same fixed axis mapping to the diamond-gradient ellipse approximation", () => {
    const node: FigmaNode = {
      id: "diamond",
      type: "RECTANGLE",
      fills: [{ ...radialPaint(), type: "GRADIENT_DIAMOND" }],
      absoluteBoundingBox: box(0, 0, 180, 90),
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 180, 90),
      children: [node],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const match = html.match(/radial-gradient\(ellipse ([\d.]+)px ([\d.]+)px/);
    const radiusX = Number(match![1]);
    const radiusY = Number(match![2]);
    expect(radiusX).toBeGreaterThan(radiusY);
  });
});

describe("linear gradient stop remapping (bug: partial-span handles stretched to fill the box)", () => {
  // CSS `linear-gradient(angle, ...)` always stretches its 0%/100% stops
  // across the box's full diagonal at that angle -- Figma's own stop
  // positions are fractions of the ACTUAL start-handle-to-end-handle
  // distance, which only coincides with the CSS full-box span when the
  // handles happen to be dragged exactly corner-to-corner. The real
  // C-fills-effects "Linear Gradient 45deg" node (authored via a rotated
  // gradientTransform, box 180x90) has handles that do NOT span
  // corner-to-corner once projected into pixel space, and rendered as a
  // near-total pixel mismatch before this fix.
  it("keeps a color stop at its real projected pixel position instead of the naive raw-position mapping", () => {
    // Handles offset from the box diagonal: start/end don't reach the
    // corners, so the naive (unmapped) stop positions would place 0%/100%
    // at the wrong spots on CSS's full-box gradient line.
    const paint: FigmaPaint = {
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0.35355679414159913, y: 0.5605996593321734 },
        { x: 1.0606703824247974, y: -0.14651392895102483 },
        { x: 0.7071135882831983, y: 0.9141564534737725 },
      ],
      gradientStops: [
        { position: 0, color: { r: 0.1, g: 0.4, b: 0.95, a: 1 } },
        { position: 1, color: { r: 0.9, g: 0.2, b: 0.6, a: 1 } },
      ],
    };
    const node: FigmaNode = {
      id: "grad45",
      type: "RECTANGLE",
      fills: [paint],
      absoluteBoundingBox: box(0, 0, 180, 90),
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 180, 90),
      children: [node],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const match = html.match(
      /linear-gradient\([\d.]+deg, rgba\([^)]+\) ([\d.]+)%,/,
    );
    expect(match).not.toBeNull();
    const firstStopPercent = Number(match![1]);
    // The raw (buggy) mapping would place the first stop at exactly 0%; the
    // real projected position for these handles is well past 0% because the
    // start handle doesn't sit at the CSS line's own start corner.
    expect(firstStopPercent).toBeGreaterThan(5);
  });
});

describe("rotation unit conversion (bug: REST rotation is radians, not degrees)", () => {
  // Figma's file-node-types docs describe `rotation` as being in degrees,
  // but it is empirically returned in RADIANS -- verified against known
  // authored values from the real corpus (an authored 15deg rotation came
  // back from REST as node.rotation === -0.26179940325453416, which is
  // exactly -15deg in radians). Treating that as degrees shrinks every
  // rotation by ~57x, rendering rotated content as visually unrotated.
  it("converts a real captured radian rotation value to the correct CSS degrees", () => {
    const node: FigmaNode = {
      id: "rotated",
      type: "RECTANGLE",
      rotation: -0.26179940325453416, // captured verbatim from the real corpus
      absoluteBoundingBox: box(0, 0, 120, 80),
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 200),
      children: [node],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const match = html.match(/rotate\((-?[\d.]+)deg\)/);
    expect(match).not.toBeNull();
    // -15deg in Figma's convention negates to +15deg for CSS (see the
    // module's Rotation caveat doc comment) -- NOT ~-0.26deg, which is what
    // the un-converted radian value produced before this fix.
    expect(Number(match![1])).toBeCloseTo(15, 1);
  });
});

describe("rotated-box AABB un-rotation (bug: CSS rotate() applied on top of the oversized bounding box)", () => {
  // absoluteBoundingBox for a rotated node is the AABB of the ALREADY
  // rotated shape (bigger than the shape's own width/height), not the
  // shape's true pre-rotation size. Sizing the div from the AABB and then
  // rotating it a second time via CSS rotates an oversized box, producing a
  // visibly too-large/wrong-aspect rotated shape -- reproduced exactly by
  // the real D-shapes "Rotated Nested Frame" node (authored 120x80, REST
  // absoluteBoundingBox came back ~136.6x108.3 for a 15deg rotation).
  it("recovers the true pre-rotation width/height instead of using the AABB size", () => {
    const node: FigmaNode = {
      id: "rotatedFrame",
      type: "FRAME",
      rotation: -0.26179940325453416, // same captured 15deg (in radians)
      // Real captured AABB for an authored 120x80 rect rotated 15deg.
      absoluteBoundingBox: box(100, 0, 136.61663055419922, 108.3323585987091),
      children: [],
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [node],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const styleMatch = html.match(
      /data-figma-node-id="rotatedFrame"[^>]*style="([^"]*)"/,
    );
    expect(styleMatch).not.toBeNull();
    const style = styleMatch![1]!.replace(/&quot;/g, '"');
    const widthMatch = style.match(/width: ([\d.]+)px/);
    const heightMatch = style.match(/height: ([\d.]+)px/);
    const width = Number(widthMatch![1]);
    const height = Number(heightMatch![1]);
    // Must recover ~120x80 (the true authored size), not the ~136.6x108.3
    // AABB the un-fixed code used to emit.
    expect(width).toBeCloseTo(120, 0);
    expect(height).toBeCloseTo(80, 0);
  });
});

describe("image-fallback sizing from render bounds (bug: OUTSIDE-stroke overflow squished into the geometric box)", () => {
  // Figma's own rendered PNG for a fallback node is cropped to the node's
  // actual visual extent (absoluteRenderBounds), which is larger than
  // absoluteBoundingBox whenever a stroke/effect overflows the fill edge
  // (e.g. an OUTSIDE-aligned stroke). Sizing the <img> from
  // absoluteBoundingBox alone squishes the fetched PNG into the wrong aspect
  // ratio. Reproduced by the real D-shapes "Stroke Outside Dashed" node: a
  // 110x70 box with a 4px OUTSIDE dashed stroke rendered by Figma as a
  // 118x78 PNG (verified by downloading the actual fallback PNG and reading
  // its dimensions), squished to 110x70 before this fix.
  it("sizes the fallback <img> from absoluteRenderBounds, not absoluteBoundingBox", () => {
    const node: FigmaNode = {
      id: "dashedFallback",
      type: "RECTANGLE",
      strokeDashes: [8, 4],
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      strokeWeight: 4,
      strokeAlign: "OUTSIDE",
      absoluteBoundingBox: box(10, 10, 110, 70),
      // Real measured fallback PNG natural size for this exact node.
      absoluteRenderBounds: box(6, 6, 118, 78),
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 200),
      children: [node],
    };
    const { html } = mapFigmaNodeToHtml(root, {
      fallbackImageUrls: {
        dashedFallback: "https://example.test/fallback.png",
      },
    });
    const imgMatch = html.match(
      /<img[^>]*data-figma-node-id="dashedFallback"[^>]*style="([^"]*)"/,
    );
    expect(imgMatch).not.toBeNull();
    const style = imgMatch![1]!.replace(/&quot;/g, '"');
    expect(style).toMatch(/width: 118px/);
    expect(style).toMatch(/height: 78px/);
  });
});

describe("font usage collection + Google Fonts loading (bug: imported text had no way to load its real font)", () => {
  // The REST-node importer mapped font-family/size/weight to CSS exactly,
  // but never requested the actual web font -- so every imported text node
  // silently substituted the browser's fallback sans-serif, which has
  // different glyph advance widths and produces a growing horizontal drift
  // on any wrapped/multi-word line. Reproduced across every text-bearing
  // fixture in the real corpus (worst on B-typography, which dropped from
  // 6.69% to 2.328% mismatch purely from this fix once combined with the
  // lineTypes fix above).
  it("collects distinct family/weight/italic combinations from TEXT nodes", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 200),
      children: [
        {
          id: "t1",
          type: "TEXT",
          characters: "Bold Heading",
          style: { fontFamily: "Inter", fontWeight: 700, fontSize: 32 },
        },
        {
          id: "t2",
          type: "TEXT",
          characters: "Italic body",
          style: {
            fontFamily: "Inter",
            fontWeight: 400,
            italic: true,
            fontSize: 16,
          },
        },
      ],
    };
    const usage = collectFontUsage(root);
    expect(usage).toContainEqual({
      family: "Inter",
      weight: 700,
      italic: false,
    });
    expect(usage).toContainEqual({
      family: "Inter",
      weight: 400,
      italic: true,
    });
  });

  it("builds a Google Fonts CSS2 URL and prepends loadable <link> tags", () => {
    const url = buildGoogleFontsUrl([
      { family: "Inter", weight: 700, italic: false },
      { family: "Inter", weight: 400, italic: true },
    ]);
    expect(url).not.toBeNull();
    expect(url).toContain("fonts.googleapis.com/css2");
    expect(url).toContain("family=Inter:ital,wght@");

    const withFonts = withFigmaFontLoading("<div>content</div>", [
      { family: "Inter", weight: 400, italic: false },
    ]);
    expect(withFonts).toContain('rel="stylesheet"');
    expect(withFonts).toContain("fonts.googleapis.com/css2");
    expect(withFonts).toContain("<div>content</div>");
  });

  it("returns the input HTML unchanged when no custom fonts were used", () => {
    expect(withFigmaFontLoading("<div>plain</div>", [])).toBe(
      "<div>plain</div>",
    );
    expect(buildGoogleFontsUrl([])).toBeNull();
  });

  it("encodes family names and bounds adversarial font metadata", () => {
    const usage = Array.from({ length: 1_000 }, (_, index) => ({
      family: `Family & ${index}`,
      weight: 100 + (index % 9) * 100,
      italic: index % 2 === 0,
    }));
    const url = buildGoogleFontsUrl(usage);
    expect(url).not.toBeNull();
    expect(url!.length).toBeLessThanOrEqual(16_384);
    expect(url).toContain("Family+%26+0");
    expect(url).not.toContain("Family+&+0");
  });
});

describe("gradientAngleDegrees sanity (unchanged, guards the stop-remap fix above)", () => {
  it("still resolves the identity left-to-right handles to 90deg", () => {
    const paint: FigmaPaint = {
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 1, y: 0 },
      ],
      gradientStops: [],
    };
    expect(gradientAngleDegrees(paint, { width: 200, height: 100 })).toBe(90);
  });
});
