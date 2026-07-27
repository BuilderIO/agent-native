/**
 * design-to-figma-svg.spec.ts
 *
 * Covers the pure, browser-free scene -> SVG serializer with hand-built
 * `FigmaSvgNode` fixtures, plus the raw-scene hydration layer
 * (`buildFillLayersFromComputedStyle` / `hydrateRawFigmaSvgNode`), which is
 * also pure — it only consumes plain computed-style strings, no DOM. The
 * Playwright-based DOM WALK (`collectRawFigmaSvgScene`, wired into
 * `renderDesignToFigmaSvg` and the `export-design-as-figma-svg` action) needs
 * a real headless Chromium and is exercised in practice, not here — same
 * split as `take-design-screenshot.spec.ts`'s `collectPageDiagnostics` (see
 * that file's docblock).
 */

import { describe, expect, it, vi } from "vitest";

import {
  buildFigmaSvgDocument,
  buildFillLayersFromComputedStyle,
  buildLinearGradientDef,
  buildRadialGradientDef,
  buildShadowFilterDef,
  embedRemoteImages,
  escapeXmlAttr,
  escapeXmlText,
  fetchImageAsDataUri,
  type FigmaSvgNode,
  gradientAngleToRotation,
  hydrateRawFigmaSvgNode,
  insetRadiiForStroke,
  insetRectForStroke,
  isAllowedFigmaSvgRenderRequest,
  isUniformRadius,
  isZeroRadii,
  objectFitToPreserveAspectRatio,
  parseComputedBoxShadow,
  parseComputedLinearGradient,
  parseComputedRadialGradient,
  type RawFigmaSvgNode,
  MAX_EMBEDDED_IMAGE_BYTES,
  roundedRectPath,
  safeFigmaSvgFilename,
  splitTopLevelCommas,
} from "./design-to-figma-svg.js";

describe("secure image embedding", () => {
  it("uses the SSRF-safe fetch seam and embeds bounded image bytes", async () => {
    const safeFetch = vi.fn(async () =>
      Promise.resolve(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        }),
      ),
    );

    await expect(
      fetchImageAsDataUri(
        "https://images.example.com/a.png",
        safeFetch as never,
      ),
    ).resolves.toBe("data:image/png;base64,iVBORw==");
    expect(safeFetch).toHaveBeenCalledWith(
      "https://images.example.com/a.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { maxRedirects: 3 },
    );
  });

  it("rejects non-image MIME types and advertised oversized bodies", async () => {
    const htmlFetch = vi.fn(async () =>
      Promise.resolve(
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(
      fetchImageAsDataUri("https://example.com/not-image", htmlFetch as never),
    ).resolves.toBeNull();

    const hugeFetch = vi.fn(async () =>
      Promise.resolve(
        new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png",
            "content-length": String(MAX_EMBEDDED_IMAGE_BYTES + 1),
          },
        }),
      ),
    );
    await expect(
      fetchImageAsDataUri("https://example.com/huge.png", hugeFetch as never),
    ).resolves.toBeNull();
  });

  it("never leaves expiring remote URLs in a self-contained export", async () => {
    const root: FigmaSvgNode = {
      id: "root",
      kind: "box",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      fills: [
        { kind: "image", href: "https://figma.example/expiring", fit: "cover" },
      ],
      children: [
        {
          id: "hero",
          name: "Hero",
          kind: "image",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          image: {
            href: "https://figma.example/also-expiring",
            fit: "cover",
          },
        },
      ],
    };
    const omitted = await embedRemoteImages(root, async () => null);

    expect(root.fills?.[0]).toMatchObject({ href: "" });
    expect(root.children?.[0].image?.href).toBe("");
    expect(omitted).toHaveLength(2);
  });
});

describe("isAllowedFigmaSvgRenderRequest", () => {
  it("allows inert local schemes without DNS and blocks private HTTP targets", async () => {
    const blocked = vi.fn(async (url: string) => url.includes("127.0.0.1"));
    await expect(
      isAllowedFigmaSvgRenderRequest("data:image/png;base64,AA", blocked),
    ).resolves.toBe(true);
    await expect(
      isAllowedFigmaSvgRenderRequest("http://127.0.0.1/secret", blocked),
    ).resolves.toBe(false);
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it("fails closed for malformed URLs and DNS validation errors", async () => {
    await expect(
      isAllowedFigmaSvgRenderRequest("not a url", vi.fn()),
    ).resolves.toBe(false);
    await expect(
      isAllowedFigmaSvgRenderRequest(
        "https://example.com/image.png",
        vi.fn().mockRejectedValue(new Error("DNS unavailable")),
      ),
    ).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Formatting / escaping
// ---------------------------------------------------------------------------

describe("escapeXmlAttr / escapeXmlText", () => {
  it("escapes attribute-unsafe characters", () => {
    expect(escapeXmlAttr('a "quoted" <tag>&')).toBe(
      "a &quot;quoted&quot; &lt;tag&gt;&amp;",
    );
  });

  it("escapes text-unsafe characters but leaves quotes alone", () => {
    expect(escapeXmlText('5 < 10 & "ok"')).toBe('5 &lt; 10 &amp; "ok"');
  });
});

describe("isUniformRadius / isZeroRadii", () => {
  it("detects uniform radii", () => {
    expect(isUniformRadius({ tl: 8, tr: 8, br: 8, bl: 8 })).toBe(true);
    expect(isUniformRadius({ tl: 8, tr: 4, br: 8, bl: 8 })).toBe(false);
  });

  it("detects all-zero radii", () => {
    expect(isZeroRadii({ tl: 0, tr: 0, br: 0, bl: 0 })).toBe(true);
    expect(isZeroRadii({ tl: 0, tr: 1, br: 0, bl: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rounded-rect path (per-corner radii)
// ---------------------------------------------------------------------------

describe("roundedRectPath", () => {
  it("emits line + arc segments for differing per-corner radii", () => {
    const path = roundedRectPath(
      { x: 0, y: 0, width: 100, height: 50 },
      { tl: 10, tr: 0, br: 20, bl: 5 },
    );
    // tl=10 arc, tr=0 (no arc, sharp corner), br=20 arc, bl=5 arc.
    expect(path).toBe(
      "M 10 0 L 100 0 L 100 30 A 20 20 0 0 1 80 50 L 5 50 A 5 5 0 0 1 0 45 L 0 10 A 10 10 0 0 1 10 0 Z",
    );
  });

  it("clamps radii that exceed half the smaller dimension", () => {
    const path = roundedRectPath(
      { x: 0, y: 0, width: 20, height: 10 },
      { tl: 100, tr: 100, br: 100, bl: 100 },
    );
    // maxR = min(20,10)/2 = 5, so every corner clamps to 5.
    expect(path).toContain("A 5 5 0 0 1");
    expect(path).not.toContain("A 100 100");
  });

  it("omits the arc command entirely for a zero-radius corner", () => {
    const path = roundedRectPath(
      { x: 0, y: 0, width: 40, height: 40 },
      { tl: 0, tr: 0, br: 0, bl: 0 },
    );
    expect(path).toBe("M 0 0 L 40 0 L 40 40 L 0 40 L 0 0 Z");
    expect(path).not.toContain("A ");
  });
});

// ---------------------------------------------------------------------------
// Border stroke inset geometry
// ---------------------------------------------------------------------------

describe("insetRectForStroke / insetRadiiForStroke", () => {
  it("insets the rect by half the stroke width on every side", () => {
    const rect = insetRectForStroke(
      { x: 10, y: 10, width: 100, height: 60 },
      4,
    );
    expect(rect).toEqual({ x: 12, y: 12, width: 96, height: 56 });
  });

  it("clamps width/height at zero for a stroke wider than the box", () => {
    const rect = insetRectForStroke({ x: 0, y: 0, width: 4, height: 4 }, 10);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });

  it("shrinks each corner radius by half the stroke width, clamped at zero", () => {
    const radii = insetRadiiForStroke({ tl: 10, tr: 2, br: 0, bl: 20 }, 4);
    expect(radii).toEqual({ tl: 8, tr: 0, br: 0, bl: 18 });
  });
});

// ---------------------------------------------------------------------------
// Gradient angle mapping
// ---------------------------------------------------------------------------

describe("gradientAngleToRotation", () => {
  it("maps CSS 90deg (to right) to SVG's unrotated default vector", () => {
    expect(gradientAngleToRotation(90)).toBe(0);
  });

  it("maps CSS 0deg (to top) to -90deg normalized to 270", () => {
    expect(gradientAngleToRotation(0)).toBe(270);
  });

  it("maps CSS 180deg (to bottom) to 90", () => {
    expect(gradientAngleToRotation(180)).toBe(90);
  });

  it("maps CSS 270deg (to left) to 180", () => {
    expect(gradientAngleToRotation(270)).toBe(180);
  });
});

describe("buildLinearGradientDef", () => {
  it("emits exact stop offsets/colors and a rotation-based gradientTransform", () => {
    const def = buildLinearGradientDef("lg-1", 45, [
      { offset: 0, color: "rgb(255, 0, 0)" },
      { offset: 0.5, color: "rgb(0, 255, 0)" },
      { offset: 1, color: "rgb(0, 0, 255)" },
    ]);
    expect(def).toBe(
      '<linearGradient id="lg-1" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(315 0.5 0.5)">' +
        '<stop offset="0%" stop-color="rgb(255, 0, 0)"/>' +
        '<stop offset="50%" stop-color="rgb(0, 255, 0)"/>' +
        '<stop offset="100%" stop-color="rgb(0, 0, 255)"/>' +
        "</linearGradient>",
    );
  });
});

describe("buildRadialGradientDef", () => {
  it("defaults to a centered circle spanning the bounding box", () => {
    const def = buildRadialGradientDef("rg-1", [
      { offset: 0, color: "#fff" },
      { offset: 1, color: "#000" },
    ]);
    expect(def).toBe(
      '<radialGradient id="rg-1" cx="0.5" cy="0.5" r="0.5">' +
        '<stop offset="0%" stop-color="#fff"/>' +
        '<stop offset="100%" stop-color="#000"/>' +
        "</radialGradient>",
    );
  });
});

// ---------------------------------------------------------------------------
// Computed-style parsers
// ---------------------------------------------------------------------------

describe("splitTopLevelCommas", () => {
  it("does not split commas nested inside rgba()/rgb()", () => {
    expect(
      splitTopLevelCommas(
        "rgba(0, 0, 0, 0.5) 0px 4px 8px 0px, rgb(255, 0, 0) 2px 2px 0px 0px",
      ),
    ).toEqual([
      "rgba(0, 0, 0, 0.5) 0px 4px 8px 0px",
      "rgb(255, 0, 0) 2px 2px 0px 0px",
    ]);
  });
});

describe("parseComputedBoxShadow", () => {
  it("returns [] for none/empty", () => {
    expect(parseComputedBoxShadow("none")).toEqual([]);
    expect(parseComputedBoxShadow(null)).toEqual([]);
    expect(parseComputedBoxShadow(undefined)).toEqual([]);
  });

  it("parses a single Chromium-normalized shadow", () => {
    expect(
      parseComputedBoxShadow("rgba(0, 0, 0, 0.25) 0px 4px 12px 0px"),
    ).toEqual([
      {
        offsetX: 0,
        offsetY: 4,
        blur: 12,
        spread: 0,
        color: "rgba(0, 0, 0, 0.25)",
        inset: false,
      },
    ]);
  });

  it("parses an inset shadow and flags it", () => {
    const [shadow] = parseComputedBoxShadow(
      "rgb(0, 0, 0) 2px 2px 0px 0px inset",
    );
    expect(shadow.inset).toBe(true);
    expect(shadow.offsetX).toBe(2);
    expect(shadow.spread).toBe(0);
  });

  it("parses multiple comma-separated shadows", () => {
    const shadows = parseComputedBoxShadow(
      "rgba(0, 0, 0, 0.25) 0px 4px 12px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px 1px",
    );
    expect(shadows).toHaveLength(2);
    expect(shadows[1]).toEqual({
      offsetX: 0,
      offsetY: 1,
      blur: 2,
      spread: 1,
      color: "rgba(0, 0, 0, 0.1)",
      inset: false,
    });
  });
});

describe("parseComputedLinearGradient", () => {
  it("parses an explicit angle and percentage stops", () => {
    expect(
      parseComputedLinearGradient(
        "linear-gradient(45deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
      ),
    ).toEqual({
      angleDeg: 45,
      stops: [
        { offset: 0, color: "rgb(255, 0, 0)" },
        { offset: 1, color: "rgb(0, 0, 255)" },
      ],
    });
  });

  it("resolves a `to right` keyword direction to 90deg", () => {
    const parsed = parseComputedLinearGradient(
      "linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
    );
    expect(parsed?.angleDeg).toBe(90);
  });

  it("defaults to 180deg (to bottom) when no direction is given", () => {
    const parsed = parseComputedLinearGradient(
      "linear-gradient(rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
    );
    expect(parsed?.angleDeg).toBe(180);
  });

  it("returns null for a non-gradient string", () => {
    expect(parseComputedLinearGradient("none")).toBeNull();
  });
});

describe("parseComputedRadialGradient", () => {
  it("extracts stops, ignoring shape/position", () => {
    const parsed = parseComputedRadialGradient(
      "radial-gradient(circle at center, rgb(255, 255, 255) 0%, rgb(0, 0, 0) 100%)",
    );
    expect(parsed?.stops).toEqual([
      { offset: 0, color: "rgb(255, 255, 255)" },
      { offset: 1, color: "rgb(0, 0, 0)" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// object-fit
// ---------------------------------------------------------------------------

describe("objectFitToPreserveAspectRatio", () => {
  it("maps cover to xMidYMid slice", () => {
    expect(objectFitToPreserveAspectRatio("cover")).toBe("xMidYMid slice");
  });
  it("maps contain to xMidYMid meet", () => {
    expect(objectFitToPreserveAspectRatio("contain")).toBe("xMidYMid meet");
  });
  it("maps stretch/none to none", () => {
    expect(objectFitToPreserveAspectRatio("stretch")).toBe("none");
    expect(objectFitToPreserveAspectRatio("none")).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Shadow filters
// ---------------------------------------------------------------------------

describe("buildShadowFilterDef", () => {
  it("emits a feDropShadow chain when every shadow has zero spread", () => {
    const def = buildShadowFilterDef("shadow-1", [
      {
        offsetX: 0,
        offsetY: 4,
        blur: 12,
        spread: 0,
        color: "rgba(0, 0, 0, 0.25)",
      },
    ]);
    expect(def).toContain("<feDropShadow");
    expect(def).toContain('dx="0" dy="4" stdDeviation="6"');
    expect(def).toContain('flood-color="rgb(0, 0, 0)"');
    expect(def).toContain('flood-opacity="0.25"');
    expect(def).not.toContain("feMorphology");
  });

  it("emits a decomposed feMorphology chain when spread is non-zero", () => {
    const def = buildShadowFilterDef("shadow-2", [
      { offsetX: 2, offsetY: 2, blur: 4, spread: 3, color: "rgb(0, 0, 0)" },
    ]);
    expect(def).toContain(
      '<feMorphology in="SourceAlpha" operator="dilate" radius="3"',
    );
    expect(def).toContain("<feGaussianBlur");
    expect(def).toContain("<feMerge>");
  });

  it("returns an empty string when every shadow is inset (caller's responsibility to report)", () => {
    const def = buildShadowFilterDef("shadow-3", [
      {
        offsetX: 0,
        offsetY: 2,
        blur: 2,
        spread: 0,
        color: "#000",
        inset: true,
      },
    ]);
    expect(def).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Full node -> SVG document rendering
// ---------------------------------------------------------------------------

describe("buildFigmaSvgDocument", () => {
  it("renders a box with a solid fill and a uniform border as a plain <rect> pair with inset stroke geometry", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Card",
      kind: "box",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      fills: [{ kind: "solid", color: "#ffffff" }],
      border: { widthPx: 4, color: "#111111" },
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 200,
      height: 100,
      root,
    });

    expect(svg).toContain(
      '<rect x="0" y="0" width="200" height="100" fill="#ffffff"/>',
    );
    expect(svg).toContain(
      '<rect x="2" y="2" width="196" height="96" fill="none" stroke="#111111" stroke-width="4"/>',
    );
    expect(report.vectorized).toContain("Card");
    expect(report.rasterized).toHaveLength(0);
  });

  it("renders per-corner radii as a <path> for both the fill and the inset stroke", () => {
    const root: FigmaSvgNode = {
      id: "root",
      kind: "box",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      cornerRadii: { tl: 20, tr: 0, br: 20, bl: 0 },
      fills: [{ kind: "solid", color: "red" }],
      border: { widthPx: 2, color: "black" },
    };
    const { svg } = buildFigmaSvgDocument({ width: 100, height: 100, root });
    // Two paths: one for the full-rect fill, one for the inset stroke.
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(2);
    // tl/br are rounded (arcs), tr/bl are sharp (0 radius, straight lines).
    expect(svg).toContain(
      'd="M 20 0 L 100 0 L 100 80 A 20 20 0 0 1 80 100 L 0 100 L 0 20 A 20 20 0 0 1 20 0 Z"',
    );
  });

  it("emits gradient defs with exact stop offsets for a linear-gradient fill", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Hero",
      kind: "box",
      rect: { x: 0, y: 0, width: 300, height: 300 }, // square: exact, not approximated
      fills: [
        {
          kind: "linear-gradient",
          angleDeg: 135,
          stops: [
            { offset: 0, color: "rgb(255, 0, 0)" },
            { offset: 1, color: "rgb(0, 0, 255)" },
          ],
        },
      ],
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 300,
      height: 300,
      root,
    });
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('<stop offset="0%" stop-color="rgb(255, 0, 0)"/>');
    expect(svg).toContain('<stop offset="100%" stop-color="rgb(0, 0, 255)"/>');
    expect(svg).toContain('gradientTransform="rotate(45 0.5 0.5)"');
    // Square box: no aspect-ratio approximation note for this fill.
    expect(report.approximated).toHaveLength(0);
  });

  it("flags a non-square element's gradient angle as approximated", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Banner",
      kind: "box",
      rect: { x: 0, y: 0, width: 400, height: 100 },
      fills: [
        {
          kind: "linear-gradient",
          angleDeg: 90,
          stops: [
            { offset: 0, color: "#fff" },
            { offset: 1, color: "#000" },
          ],
        },
      ],
    };
    const { report } = buildFigmaSvgDocument({ width: 400, height: 100, root });
    expect(report.approximated.some((a) => a.node === "Banner")).toBe(true);
  });

  it("stacks multiple background layers in reverse so the first CSS layer paints on top", () => {
    const root: FigmaSvgNode = {
      id: "root",
      kind: "box",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      fills: [
        { kind: "solid", color: "rgba(255,0,0,0.5)" }, // CSS layer 0 (topmost)
        { kind: "solid", color: "blue" }, // CSS layer 1 (underneath)
      ],
    };
    const { svg } = buildFigmaSvgDocument({ width: 100, height: 100, root });
    const blueIndex = svg.indexOf('fill="blue"');
    const redIndex = svg.indexOf('fill="rgba(255,0,0,0.5)"');
    expect(blueIndex).toBeGreaterThan(-1);
    expect(redIndex).toBeGreaterThan(blueIndex); // painted later == on top
  });

  it("renders multi-line text as tspans at the exact supplied x/y positions", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Headline",
      kind: "text",
      rect: { x: 10, y: 10, width: 200, height: 60 },
      text: {
        lines: [
          { text: "Hello", x: 10, y: 24 },
          { text: "World", x: 10, y: 48 },
        ],
        style: {
          fontFamily: "Inter",
          fontSizePx: 16,
          fontWeight: 700,
          color: "#111111",
          textAlign: "left",
        },
      },
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 220,
      height: 80,
      root,
    });
    expect(svg).toContain('<tspan x="10" y="24">Hello</tspan>');
    expect(svg).toContain('<tspan x="10" y="48">World</tspan>');
    expect(svg).toContain('font-family="Inter"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('dominant-baseline="central"');
    expect(report.vectorizedTextCaveat).toContain("outlined vector paths");
  });

  it("clips a cover-fit image to its rounded rect and reports it as vectorized geometry", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Avatar",
      kind: "image",
      rect: { x: 0, y: 0, width: 64, height: 64 },
      cornerRadii: { tl: 32, tr: 32, br: 32, bl: 32 },
      image: { href: "https://example.com/a.png", fit: "cover" },
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 64,
      height: 64,
      root,
    });
    expect(svg).toContain("<clipPath");
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(svg).toContain('clip-path="url(#clip-1)"');
    expect(report.vectorized).toContain("Avatar");
  });

  it("marks an unsupported node (video/canvas/iframe/backdrop-blur) as rasterized with a reason", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Live chart",
      kind: "raster",
      rect: { x: 0, y: 0, width: 300, height: 200 },
      raster: {
        href: "https://cdn.example.com/exports/live-chart.png",
        reason: "canvas element — rasterized via screenshot",
      },
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 300,
      height: 200,
      root,
    });
    expect(svg).toContain("<image");
    expect(report.rasterized).toEqual([
      {
        node: "Live chart",
        reason: "canvas element — rasterized via screenshot",
      },
    ]);
  });

  it("wraps rotated/opacity-adjusted nodes in a <g transform/opacity>", () => {
    const root: FigmaSvgNode = {
      id: "root",
      kind: "box",
      rect: { x: 10, y: 10, width: 40, height: 20 },
      rotationDeg: 15,
      opacity: 0.5,
      fills: [{ kind: "solid", color: "green" }],
    };
    const { svg } = buildFigmaSvgDocument({ width: 60, height: 40, root });
    expect(svg).toContain('transform="rotate(15 30 20)"');
    expect(svg).toContain('opacity="0.5"');
  });

  it("recurses into children under a parent group", () => {
    const root: FigmaSvgNode = {
      id: "root",
      kind: "box",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ kind: "solid", color: "white" }],
      children: [
        {
          id: "child-1",
          name: "Label",
          kind: "text",
          rect: { x: 10, y: 10, width: 80, height: 20 },
          text: {
            lines: [{ text: "Child", x: 10, y: 20 }],
            style: { fontFamily: "Inter", fontSizePx: 14, color: "#000" },
          },
        },
      ],
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 100,
      height: 100,
      root,
    });
    expect(svg).toContain(">Child<");
    expect(report.vectorized).toEqual(
      expect.arrayContaining(["root", "Label"]),
    );
  });

  it("produces a complete, well-formed document for a simple two-element screen", () => {
    const root: FigmaSvgNode = {
      id: "screen",
      name: "Screen",
      kind: "box",
      rect: { x: 0, y: 0, width: 320, height: 120 },
      fills: [{ kind: "solid", color: "#0f172a" }],
      children: [
        {
          id: "label",
          name: "Title",
          kind: "text",
          rect: { x: 24, y: 40, width: 200, height: 24 },
          text: {
            lines: [{ text: "Ship it", x: 24, y: 52 }],
            style: {
              fontFamily: "Inter",
              fontSizePx: 20,
              fontWeight: 600,
              color: "#f8fafc",
              textAlign: "left",
            },
          },
        },
      ],
    };
    const { svg } = buildFigmaSvgDocument({
      width: 320,
      height: 120,
      title: "Two Element Screen",
      root,
    });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<title>Two Element Screen</title>");
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it('does not emit a phantom fill="none" shape for a paint-less layout wrapper (no fills/border/shadow)', () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Wrapper",
      kind: "box",
      // Deliberately oversized vs. its single child, mirroring <body>
      // stretching to the full render viewport while real content is
      // narrower — this must never surface as a visible/invisible shape.
      rect: { x: 0, y: 0, width: 1440, height: 300 },
      children: [
        {
          id: "child",
          name: "Card",
          kind: "box",
          rect: { x: 0, y: 0, width: 400, height: 300 },
          fills: [{ kind: "solid", color: "#ffffff" }],
        },
      ],
    };
    const { svg, report } = buildFigmaSvgDocument({
      width: 1440,
      height: 300,
      root,
    });
    expect(svg).not.toContain('fill="none"');
    expect(svg).toContain(
      '<rect x="0" y="0" width="400" height="300" fill="#ffffff"/>',
    );
    // Exactly one <rect> — the child's — no phantom shape for the wrapper.
    expect((svg.match(/<rect /g) || []).length).toBe(1);
    // Still recorded as a (paint-less) vectorized layer, just no shape emitted.
    expect(report.vectorized).toContain("Wrapper");
  });

  it("still emits a carrier shape for a box that has a shadow filter but no fill", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "ShadowOnly",
      kind: "box",
      rect: { x: 0, y: 0, width: 100, height: 50 },
      shadows: [
        {
          offsetX: 0,
          offsetY: 4,
          blur: 8,
          spread: 0,
          color: "rgba(0,0,0,0.3)",
        },
      ],
    };
    const { svg } = buildFigmaSvgDocument({ width: 100, height: 50, root });
    expect(svg).toContain('fill="none"');
    expect(svg).toContain("filter=");
  });
});

describe("safeFigmaSvgFilename", () => {
  it("sanitizes the title and appends a .svg extension with a timestamp", () => {
    const filename = safeFigmaSvgFilename("My Cool Design!!");
    expect(filename).toMatch(/^My-Cool-Design-figma-\d+\.svg$/);
  });

  it("falls back to 'design' for an empty/undefined title", () => {
    expect(safeFigmaSvgFilename(undefined)).toMatch(/^design-figma-\d+\.svg$/);
  });
});

// ---------------------------------------------------------------------------
// Raw scene hydration (pure — takes computed-style strings, no DOM/browser)
// ---------------------------------------------------------------------------

describe("buildFillLayersFromComputedStyle", () => {
  it("returns just the solid background-color when there is no background-image", () => {
    expect(
      buildFillLayersFromComputedStyle("rgb(255, 255, 255)", "none"),
    ).toEqual([{ kind: "solid", color: "rgba(255, 255, 255, 1)" }]);
  });

  it("omits a fully transparent background-color", () => {
    expect(
      buildFillLayersFromComputedStyle("rgba(0, 0, 0, 0)", "none"),
    ).toEqual([]);
  });

  it("puts the background-image gradient layer BEFORE the background-color (color is bottommost)", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgb(17, 24, 39)",
      "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
    );
    expect(layers).toEqual([
      {
        kind: "linear-gradient",
        angleDeg: 90,
        stops: [
          { offset: 0, color: "rgb(255, 0, 0)" },
          { offset: 1, color: "rgb(0, 0, 255)" },
        ],
      },
      { kind: "solid", color: "rgba(17, 24, 39, 1)" },
    ]);
  });

  it("parses a url() background-image as an image fill", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      'url("https://example.com/bg.png")',
    );
    expect(layers).toEqual([
      { kind: "image", href: "https://example.com/bg.png", fit: "cover" },
    ]);
  });
});

function rawBoxFixture(
  overrides: Partial<RawFigmaSvgNode> = {},
): RawFigmaSvgNode {
  return {
    id: "n1",
    domTag: "DIV",
    rect: { x: 0, y: 0, width: 100, height: 100 },
    rotationDeg: 0,
    opacity: 1,
    cornerRadiiRaw: { tl: 0, tr: 0, br: 0, bl: 0 },
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    boxShadow: "none",
    borderWidthPx: 0,
    borderColor: "rgb(0, 0, 0)",
    borderStyle: "none",
    borderNonUniform: false,
    backdropFilter: "none",
    isLeafText: false,
    children: [],
    ...overrides,
  };
}

describe("hydrateRawFigmaSvgNode", () => {
  it("hydrates a plain box with solid fill and border", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        name: "Card",
        backgroundColor: "rgb(255, 255, 255)",
        borderWidthPx: 2,
        borderColor: "rgb(0, 0, 0)",
        borderStyle: "solid",
      }),
    );
    expect(node.kind).toBe("box");
    expect(node.fills).toEqual([
      { kind: "solid", color: "rgba(255, 255, 255, 1)" },
    ]);
    expect(node.border).toEqual({
      widthPx: 2,
      color: "rgb(0, 0, 0)",
      dashed: false,
      nonUniform: undefined,
    });
  });

  it("omits opacity/rotation/cornerRadii when at their neutral defaults", () => {
    const node = hydrateRawFigmaSvgNode(rawBoxFixture());
    expect(node.opacity).toBeUndefined();
    expect(node.rotationDeg).toBeUndefined();
    expect(node.cornerRadii).toBeUndefined();
  });

  it("flags a non-uniform border for the approximated-border report path", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        borderWidthPx: 2,
        borderStyle: "solid",
        borderNonUniform: true,
      }),
    );
    expect(node.border?.nonUniform).toBe(true);
  });

  it("hydrates a rasterized node (video/canvas/iframe/backdrop-blur) regardless of other fields", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        rasterReason:
          "backdrop-filter cannot be expressed in SVG — rasterized this element's region via screenshot.",
        rasterHref: "data:image/png;base64,AAA",
      }),
    );
    expect(node.kind).toBe("raster");
    expect(node.raster).toEqual({
      href: "data:image/png;base64,AAA",
      reason:
        "backdrop-filter cannot be expressed in SVG — rasterized this element's region via screenshot.",
    });
  });

  it("hydrates a leaf text node from textLines/textStyle", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        isLeafText: true,
        textLines: [{ text: "Hello", x: 10, y: 20 }],
        textStyle: {
          fontFamily: "Inter",
          fontSizePx: 16,
          fontWeight: 700,
          italic: false,
          letterSpacingPx: 0,
          color: "rgb(0, 0, 0)",
          textAlign: "center",
        },
      }),
    );
    expect(node.kind).toBe("text");
    expect(node.text?.lines).toEqual([{ text: "Hello", x: 10, y: 20 }]);
    expect(node.text?.style.textAlign).toBe("center");
  });

  it("hydrates an IMG node with a normalized object-fit", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        domTag: "IMG",
        imgSrc: "https://example.com/a.png",
        imgObjectFit: "scale-down",
      }),
    );
    expect(node.kind).toBe("image");
    expect(node.image).toEqual({
      href: "https://example.com/a.png",
      fit: "contain",
    });
  });

  it("recurses into children", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        children: [rawBoxFixture({ id: "child", name: "Child" })],
      }),
    );
    expect(node.children).toHaveLength(1);
    expect(node.children?.[0].name).toBe("Child");
  });
});
