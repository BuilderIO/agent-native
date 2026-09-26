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
    expect(radiusX).toBeGreaterThan(radiusY);
    expect(radiusX).toBeCloseTo(180, 0);
    expect(radiusY).toBeCloseTo(90, 0);
  });

  it("applies the same fixed axis mapping to the diamond gradient's quadrant tiles", () => {
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
    const match = html.match(/background-size:\s*([\d.]+)px ([\d.]+)px/);
    expect(match).not.toBeNull();
    const radiusX = Number(match![1]);
    const radiusY = Number(match![2]);
    expect(radiusX).toBeGreaterThan(radiusY);
    expect(radiusX).toBeCloseTo(180, 0);
    expect(radiusY).toBeCloseTo(90, 0);
  });
});

describe("linear gradient stop remapping (bug: partial-span handles stretched to fill the box)", () => {
  it("keeps a color stop at its real projected pixel position instead of the naive raw-position mapping", () => {
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
    expect(firstStopPercent).toBeGreaterThan(5);
  });
});

describe("rotation unit conversion (bug: REST rotation is radians, not degrees)", () => {
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
    expect(Number(match![1])).toBeCloseTo(-15, 1);
  });
});

describe("rotated-box AABB un-rotation (bug: CSS rotate() applied on top of the oversized bounding box)", () => {
  it("recovers the true pre-rotation width/height instead of using the AABB size", () => {
    const node: FigmaNode = {
      id: "rotatedFrame",
      type: "FRAME",
      rotation: -0.26179940325453416, // same captured 15deg (in radians)
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
    expect(width).toBeCloseTo(120, 0);
    expect(height).toBeCloseTo(80, 0);
  });
});

describe("image-fallback sizing from render bounds (bug: OUTSIDE-stroke overflow squished into the geometric box)", () => {
  it("sizes the fallback <img> from absoluteRenderBounds, not absoluteBoundingBox", () => {
    const node: FigmaNode = {
      id: "dashedFallback",
      type: "RECTANGLE",
      strokeDashes: [8, 4],
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      strokeWeight: 4,
      strokeAlign: "OUTSIDE",
      absoluteBoundingBox: box(10, 10, 110, 70),
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
