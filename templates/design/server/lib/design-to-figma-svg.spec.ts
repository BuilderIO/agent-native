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
  embedRemoteImages,
  escapeXmlAttr,
  escapeXmlText,
  fetchImageAsDataUri,
  figmaSvgSceneExtent,
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
  parseComputedDropShadowFilter,
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
    ).resolves.toEqual({ ok: true, dataUri: "data:image/png;base64,iVBORw==" });
    expect(safeFetch).toHaveBeenCalledWith(
      "https://images.example.com/a.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      { maxRedirects: 3 },
    );
  });

  it("says WHY an image was not embedded, so a size cap does not read as a block", async () => {
    const htmlFetch = vi.fn(async () =>
      Promise.resolve(
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(
      fetchImageAsDataUri("https://example.com/not-image", htmlFetch as never),
    ).resolves.toEqual({
      ok: false,
      reason: expect.stringContaining("not an image"),
    });

    const hugeFetch = vi.fn(async () =>
      Promise.resolve(
        new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png",
            "content-length": String(MAX_EMBEDDED_IMAGE_BYTES * 64),
          },
        }),
      ),
    );
    await expect(
      fetchImageAsDataUri("https://example.com/huge.png", hugeFetch as never),
    ).resolves.toEqual({
      ok: false,
      reason: expect.stringContaining("read limit"),
    });
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
    const omitted = await embedRemoteImages(root, async () => ({
      ok: false,
      reason: "the fetch failed",
    }));

    expect(root.fills?.[0]).toMatchObject({ href: "" });
    expect(root.children?.[0].image?.href).toBe("");
    expect(omitted).toHaveLength(2);
  });
});

describe("objectFitToPreserveAspectRatio", () => {
  it("anchors top-left when the element does", async () => {
    // The importer anchors a fallback render top-left, because Figma's
    // `absoluteRenderBounds` states where the ink STARTS. Centring it in the
    // export moved the artwork back — 1.26 points of round-trip drift.
    const { objectFitToPreserveAspectRatio } =
      await import("../../shared/figma-svg-scene.js");
    expect(objectFitToPreserveAspectRatio("contain", "0px 0px")).toBe(
      "xMinYMin meet",
    );
    expect(objectFitToPreserveAspectRatio("cover", "0% 0%")).toBe(
      "xMinYMin slice",
    );
  });

  it("keeps the centred default otherwise", async () => {
    const { objectFitToPreserveAspectRatio } =
      await import("../../shared/figma-svg-scene.js");
    expect(objectFitToPreserveAspectRatio("contain")).toBe("xMidYMid meet");
    expect(objectFitToPreserveAspectRatio("contain", "50% 50%")).toBe(
      "xMidYMid meet",
    );
    expect(objectFitToPreserveAspectRatio("stretch", "0px 0px")).toBe("none");
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
        '<stop offset="0%" stop-color="rgb(255, 255, 255)"/>' +
        '<stop offset="100%" stop-color="rgb(0, 0, 0)"/>' +
        "</radialGradient>",
    );
  });

  it("carries stop alpha in stop-opacity, which Figma reads and rgba() stop-color does not", () => {
    const def = buildRadialGradientDef("rg-2", [
      { offset: 0, color: "rgba(255, 0, 0, 0.25)" },
      { offset: 1, color: "rgb(0, 0, 0)" },
    ]);
    expect(def).toContain('stop-color="rgb(255, 0, 0)" stop-opacity="0.25"');
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
      '<rect x="0" y="0" width="200" height="100" fill="rgb(255, 255, 255)"/>',
    );
    expect(svg).toContain(
      '<rect x="2" y="2" width="196" height="96" fill="none" stroke="rgb(17, 17, 17)" stroke-width="4"/>',
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
    // 135deg on a 300x300 box runs corner to corner, top-right to bottom-left.
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(svg).toContain('x1="0" y1="0" x2="300" y2="300"');
    expect(report.approximated).toHaveLength(0);
  });

  it("maps a non-square element's gradient exactly instead of approximating it", () => {
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
    const { svg, report } = buildFigmaSvgDocument({
      width: 400,
      height: 100,
      root,
    });
    // 90deg is left-to-right; user-space endpoints span the real 400px width,
    // which an objectBoundingBox rotation could not express on a 4:1 box.
    expect(svg).toContain('x1="0" y1="50" x2="400" y2="50"');
    expect(report.approximated.some((a) => a.node === "Banner")).toBe(false);
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
    const blueIndex = svg.indexOf('fill="rgb(0, 0, 255)"');
    // Alpha moves to fill-opacity; SVG ignores the alpha channel of `fill`.
    const redIndex = svg.indexOf('fill="rgb(255, 0, 0)" fill-opacity="0.5"');
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
    expect(svg).not.toContain("dominant-baseline");
    expect(report.vectorizedTextCaveat).toContain("live, editable type");
    expect(report.vectorizedTextCaveat).not.toContain("outlined vector paths");
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
      '<rect x="0" y="0" width="400" height="300" fill="rgb(255, 255, 255)"/>',
    );
    // Exactly one <rect> — the child's — no phantom shape for the wrapper.
    expect((svg.match(/<rect /g) || []).length).toBe(1);
    // Still recorded as a (paint-less) vectorized layer, just no shape emitted.
    expect(report.vectorized).toContain("Wrapper");
  });

  it("paints a shadow-only box as its own geometry, not a fill-less carrier", () => {
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
    // Figma's importer drops filter-based shadows, so the shadow is emitted as
    // an offset, blurred, shadow-coloured shape of its own. A `fill="none"`
    // carrier would arrive there as an invisible layer.
    expect(svg).toContain('y="4"');
    expect(svg).toContain('fill="rgb(0, 0, 0)" fill-opacity="0.3"');
    expect(svg).toContain("filter=");
    expect(svg).not.toContain('fill="none"');
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
    filter: "none",
    mixBlendMode: "normal",
    imageRendering: "auto",
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

describe("paints the box model cannot carry", () => {
  // These reach the SVG as a screenshot of the element's region rather than as
  // geometry. Each one previously left a visible hole in what Figma received:
  // a blank tile where an angular gradient should be, and a masked element
  // painted at full size — the Positivus contact block covered its own form
  // with the black rectangle the mask is supposed to reveal a starburst of.
  it("hydrates a conic-gradient leaf as a raster", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        rasterReason:
          "conic-gradient has no SVG equivalent — rasterized this element's region via screenshot.",
        rasterHref: "data:image/png;base64,AAA",
      }),
    );
    expect(node.kind).toBe("raster");
    expect(node.raster?.reason).toContain("conic-gradient");
  });

  it("hydrates a clip-path / mask element as a raster", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        rasterReason:
          "clip-path / mask has no SVG equivalent here — rasterized this element's region via screenshot.",
        rasterHref: "data:image/png;base64,AAA",
      }),
    );
    expect(node.kind).toBe("raster");
    expect(node.raster?.reason).toContain("clip-path");
  });

  // A raster whose screenshot could not be taken must still be reported, not
  // quietly emitted as a normal box that paints its background over the design.
  it("keeps a raster node a raster even when the screenshot failed", () => {
    const node = hydrateRawFigmaSvgNode(
      rawBoxFixture({
        rasterReason: "clip-path / mask has no SVG equivalent here.",
      }),
    );
    expect(node.kind).toBe("raster");
    expect(node.raster?.href).toBe("");
  });
});

describe("image fills with no resolvable source", () => {
  const imageFillNode = (href: string) =>
    hydrateRawFigmaSvgNode(
      rawBoxFixture({ backgroundImage: `url("${href}")` }),
    );

  // A clipboard import cannot carry image bytes, so it points unresolved fills
  // at about:blank until hydrate-figma-paste-images fills them in. Passing that
  // through hands Figma a broken reference — and a renderer whose own document
  // URL is about:blank resolves it to the document ITSELF, painting a recursive
  // smear of the page where the design has a placeholder.
  it("keeps a resolvable http/data/blob source", () => {
    for (const href of [
      "https://example.com/a.png",
      "data:image/png;base64,AAA",
      "blob:https://example.com/x",
    ]) {
      const node = imageFillNode(href);
      expect(node.fills?.some((f) => f.kind === "image")).toBe(true);
    }
  });

  it("still records an unresolvable source as an image fill for the paint builder to reject", () => {
    const node = imageFillNode("about:blank");
    expect(node.fills?.some((f) => f.kind === "image")).toBe(true);
  });
});

describe("figmaSvgSceneExtent", () => {
  // An SVG root clips to its viewBox, so an artboard sized to the frame drops
  // whatever the design draws past it. The Untitled UI dashboard runs 106px
  // below its 960px frame and shipped to Figma with that strip missing.
  const child = (rect: FigmaSvgNode["rect"]): FigmaSvgNode => ({
    id: "c",
    name: "child",
    kind: "box",
    rect,
    fills: [{ kind: "solid", color: "#000000" }],
  });

  it("reports how far content reaches past the frame's right and bottom", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Screen",
      kind: "box",
      rect: { x: 0, y: 0, width: 1440, height: 960 },
      children: [child({ x: 0, y: 900, width: 1440, height: 166 })],
    };
    expect(figmaSvgSceneExtent(root)).toEqual({ right: 1440, bottom: 1066 });
  });

  // Growing up or left would move the viewBox ORIGIN, shifting every
  // coordinate in the document at once — that scored 63% on a design whose
  // only stray node was a shadow just off the left edge.
  it("never reports past the top or left edge", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Screen",
      kind: "box",
      rect: { x: 0, y: 0, width: 400, height: 300 },
      children: [child({ x: -40, y: -30, width: 100, height: 100 })],
    };
    expect(figmaSvgSceneExtent(root)).toEqual({ right: 400, bottom: 300 });
  });
});

describe("parseComputedDropShadowFilter", () => {
  // The REST importer emits `drop-shadow()` for a layer whose shadow Figma
  // casts from its CONTENT and does not knock out. drop-shadow() has no
  // spread, so the importer carries the original values in a custom property.
  it("prefers the importer's exact values, spread included", () => {
    expect(
      parseComputedDropShadowFilter(
        "drop-shadow(0px 24px 12px rgba(17, 24, 39, 0.25))",
        "rgba(17, 24, 39, 0.25) 0px 24px 48px -12px",
      ),
    ).toEqual([
      {
        offsetX: 0,
        offsetY: 24,
        blur: 48,
        spread: -12,
        color: "rgba(17, 24, 39, 0.25)",
        inset: false,
        castFromContent: true,
      },
    ]);
  });

  it("falls back to the filter alone, doubling the standard deviation", () => {
    expect(
      parseComputedDropShadowFilter(
        "drop-shadow(0px 24px 12px rgba(0, 0, 0, 0.5))",
      ),
    ).toEqual([
      {
        offsetX: 0,
        offsetY: 24,
        blur: 24,
        spread: 0,
        color: "rgba(0, 0, 0, 0.5)",
        castFromContent: true,
      },
    ]);
  });

  it("ignores a custom property that describes a different shadow", () => {
    // Custom properties inherit, so a descendant sees its ancestor's value, and
    // a layer whose filter changed later still carries the old one.
    expect(
      parseComputedDropShadowFilter(
        "drop-shadow(0px 24px 12px rgba(0, 0, 0, 0.5))",
        "rgba(9, 9, 9, 0.4) 0px 90px 10px -3px",
      ),
    ).toEqual([
      {
        offsetX: 0,
        offsetY: 24,
        blur: 24,
        spread: 0,
        color: "rgba(0, 0, 0, 0.5)",
        castFromContent: true,
      },
    ]);
  });

  it("ignores anything that is not a lone drop-shadow", () => {
    expect(parseComputedDropShadowFilter("none")).toEqual([]);
    expect(parseComputedDropShadowFilter("blur(4px)")).toEqual([]);
  });
});

describe("background-image sizing on export", () => {
  // Figma's four image scale modes reach the DOM only through
  // `background-size`: FILL is cover, FIT is contain, STRETCH is 100% 100%,
  // and a CROP is an explicit pixel size with an offset. Every layer used to
  // export as cover, which crops the three that are not.
  const url = 'url("https://img.example/a.png")';

  it("keeps FIT as contain rather than cropping it", () => {
    expect(
      buildFillLayersFromComputedStyle("rgba(0, 0, 0, 0)", url, "contain"),
    ).toEqual([
      { kind: "image", href: "https://img.example/a.png", fit: "contain" },
    ]);
  });

  it("keeps STRETCH from being cropped like cover", () => {
    expect(
      buildFillLayersFromComputedStyle("rgba(0, 0, 0, 0)", url, "100% 100%"),
    ).toEqual([
      { kind: "image", href: "https://img.example/a.png", fit: "stretch" },
    ]);
  });

  it("carries a CROP's own size and offset", () => {
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        url,
        "1193.32px 706px",
        "-40px -12px",
      ),
    ).toEqual([
      {
        kind: "image",
        href: "https://img.example/a.png",
        fit: "stretch",
        sizePx: { width: 1193.32, height: 706 },
        offsetPx: { x: -40, y: -12 },
      },
    ]);
  });

  it("repeats a shorter size list across the layers, as CSS does", () => {
    // One `contain` with two images applies to both; leaving the tail unset
    // silently exported the second layer as cover.
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      `${url}, ${url}`,
      "contain",
    );
    expect(layers.map((l) => (l as { fit: string }).fit)).toEqual([
      "contain",
      "contain",
    ]);
  });

  it("carries a TILE's repeat and its tile size", () => {
    // TILE is the one scale mode `background-size` alone cannot express: both
    // importers emit it as a size plus `repeat`, and reading only the size
    // exported a tiled fill as one stretched copy over the whole box.
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        url,
        "16px 16px",
        "0% 0%",
        "repeat",
      ),
    ).toEqual([
      {
        kind: "image",
        href: "https://img.example/a.png",
        fit: "stretch",
        sizePx: { width: 16, height: 16 },
        repeat: true,
      },
    ]);
  });

  it("marks a TILE whose size stayed `auto` as repeating with no known tile", () => {
    // An unresolved intrinsic size must stay distinguishable from a resolved
    // one: the exporter reports the tile it cannot reproduce instead of
    // silently painting a single covering image. The fit stays the honest one
    // — claiming a `stretch` we cannot draw would be a second wrong answer.
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        url,
        "auto",
        "0% 0%",
        "repeat",
      ),
    ).toEqual([
      {
        kind: "image",
        href: "https://img.example/a.png",
        fit: "cover",
        repeat: true,
      },
    ]);
  });

  it("does not read CSS's default `repeat` as tiling intent", () => {
    // `repeat` is the CSS INITIAL value, so getComputedStyle reports it for
    // every background whose author never mentioned repeating. Our importers
    // always state `no-repeat`, so no corpus case shows this — but agent
    // HTML is full of `background-size: cover` with no repeat, and treating
    // that as a tile exported it stretched instead of covered. What decides
    // it is whether the image already fills the box.
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        url,
        "cover",
        "50% 50%",
        "repeat",
      ),
    ).toEqual([
      { kind: "image", href: "https://img.example/a.png", fit: "cover" },
    ]);

    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        url,
        "100% 100%",
        "50% 50%",
        "repeat",
      ),
    ).toEqual([
      { kind: "image", href: "https://img.example/a.png", fit: "stretch" },
    ]);
  });

  it("keeps a tiled background's phase from background-position", () => {
    // On a repeating background, `background-position` is the tile PHASE, not
    // a one-off offset — dropping it anchored every tiling at the box origin.
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        url,
        "16px 16px",
        "8px 4px",
        "repeat",
      ),
    ).toEqual([
      {
        kind: "image",
        href: "https://img.example/a.png",
        fit: "stretch",
        sizePx: { width: 16, height: 16 },
        offsetPx: { x: 8, y: 4 },
        repeat: true,
      },
    ]);
  });

  it("reports `round` and `space` repeats instead of dropping them", () => {
    // An SVG pattern repeats at the tile's own size: no `round` rescaling to a
    // whole number of tiles, no `space` distribution. Chromium keeps both
    // verbatim in the computed value, including two-value forms.
    for (const repeat of ["round", "space", "repeat space"]) {
      const [layer] = buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        url,
        "16px 16px",
        "0% 0%",
        repeat,
      );
      expect(layer).toMatchObject({ fit: "cover", repeatAxis: repeat });
    }
  });

  it("reports `round` even when the size already fills the box", () => {
    // `round` rescales the tile to a whole count even under `cover`. Deciding
    // it "probably does not matter here" is a judgement the report should not
    // make silently on the reader's behalf.
    const [layer] = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      url,
      "cover",
      "50% 50%",
      "round",
    );
    expect(layer).toMatchObject({ repeatAxis: "round" });
  });

  it("carries a non-pixel tile position for the emitter to resolve", () => {
    // Chromium computes `center` to `50% 50%`, which the pixel scan cannot
    // see. A percentage phase is a fraction of the box minus the tile, so it
    // resolves where the box is known rather than here.
    const [layer] = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      url,
      "16px 16px",
      "50% 50%",
      "repeat",
    );
    expect(layer).toMatchObject({
      sizePx: { width: 16, height: 16 },
      positionRaw: "50% 50%",
      repeat: true,
    });
  });

  it("does not carry the default `0% 0%` tile position as a phase", () => {
    const [layer] = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      url,
      "16px 16px",
      "0% 0%",
      "repeat",
    );
    expect((layer as { positionRaw?: string }).positionRaw).toBeUndefined();
  });

  it("reports a background-size that computed to one length", () => {
    // Chromium computes `16px auto` — and a bare `16px` — to a single value,
    // meaning that width with a proportional height. Without the image's
    // intrinsic ratio the size cannot be reproduced, so it is reported.
    const [layer] = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      url,
      "16px",
      "0% 0%",
      "no-repeat",
    );
    expect(layer).toMatchObject({ fit: "cover", singleAxisSize: "16px" });
  });

  it("catches a calc() stop position, which survives into computed styles", () => {
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        "linear-gradient(90deg, rgb(255, 0, 0) calc(50% - 10px), rgb(0, 0, 255) 100%)",
      ).map((l) => l.kind),
    ).toEqual(["unsupported"]);
  });

  it("keeps an ordinary transparent-to-colour fade readable", () => {
    // The commonest real gradient in the corpus. Over-catching this would
    // rasterize a large share of every design.
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        "linear-gradient(90deg, rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 100%)",
      ).map((l) => l.kind),
    ).toEqual(["linear-gradient"]);
  });

  it("does not treat a one-axis repeat as a two-axis tile", () => {
    // An SVG pattern repeats on both axes and has no one-axis form, so
    // `repeat-x` coming back tiled vertically would cover rows the design
    // leaves bare. Figma's TILE is always both axes; a one-axis repeat only
    // reaches here from agent-authored HTML, and is reported, not guessed.
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      url,
      "16px 16px",
      "0% 0%",
      "repeat-x",
    );
    expect(layers).toEqual([
      {
        kind: "image",
        href: "https://img.example/a.png",
        fit: "cover",
        repeatAxis: "repeat-x",
      },
    ]);
  });

  it("reports a two-position gradient stop instead of painting it black", () => {
    // `<colour> 0 50%` ends in a percentage, so an "ends in %" check passes it
    // — but the parser strips only `50%` and leaves `<colour> 0` as the
    // colour, which is an invalid `stop-color` that renders black.
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      "linear-gradient(90deg, rgb(238, 238, 238) 0 50%, rgb(255, 255, 255) 50% 100%)",
    );
    expect(layers.map((l) => l.kind)).toEqual(["unsupported"]);
  });

  it("catches a two-position stop whose residue is also a percentage", () => {
    // `<colour> 20% 30%` strips to `<colour> 20%`, which is still a position
    // glued to the colour — checking only for a residual bare number or a
    // non-percent length missed it, and the parser paints it black.
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      "linear-gradient(90deg, rgb(255, 0, 0) 20% 30%, rgb(0, 0, 255) 100%)",
    );
    expect(layers.map((l) => l.kind)).toEqual(["unsupported"]);
  });

  it("does not mistake radial geometry for an unreadable stop", () => {
    // `90% 40% at 50% 0%` is the gradient's GEOMETRY, not a colour stop.
    // Recognising geometry by its shape missed this form, and stripping its
    // trailing position left `... at 50%`, which read as a colour carrying a
    // position — the whole gradient was dropped from the export. A stop is
    // identified by containing a colour, which geometry never does.
    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        "radial-gradient(90% 40% at 50% 0%, rgba(129, 140, 248, 0.28), rgba(0, 0, 0, 0) 65%)",
      ).map((l) => l.kind),
    ).toEqual(["radial-gradient"]);

    expect(
      buildFillLayersFromComputedStyle(
        "rgba(0, 0, 0, 0)",
        "radial-gradient(ellipse 70% 55% at 78% 12%, rgba(99, 102, 241, 0.3), transparent 62%)",
      ).map((l) => l.kind),
    ).toEqual(["radial-gradient"]);
  });

  it("does not over-catch ordinary single-percentage stops", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      "linear-gradient(90deg, rgb(255, 0, 0) 20%, rgb(0, 0, 255) 80%)",
    );
    expect(layers.map((l) => l.kind)).toEqual(["linear-gradient"]);
  });

  it("still reads ordinary percentage-positioned gradient stops", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      "linear-gradient(90deg, rgb(238, 238, 238) 0%, rgb(255, 255, 255) 100%)",
    );
    expect(layers.map((l) => l.kind)).toEqual(["linear-gradient"]);
  });

  it("does not treat the other scale modes' `no-repeat` as a tile", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      url,
      "cover",
      "center",
      "no-repeat",
    );
    expect(layers).toEqual([
      { kind: "image", href: "https://img.example/a.png", fit: "cover" },
    ]);
  });

  it("repeats a shorter repeat list across the layers, as CSS does", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      `${url}, ${url}`,
      "8px 8px",
      "0% 0%",
      "repeat",
    );
    expect(
      layers.map((l) => (l as { repeat?: boolean }).repeat ?? false),
    ).toEqual([true, true]);
  });

  it("still defaults to cover, which is FILL and the common case", () => {
    expect(
      buildFillLayersFromComputedStyle("rgba(0, 0, 0, 0)", url, "cover"),
    ).toEqual([
      { kind: "image", href: "https://img.example/a.png", fit: "cover" },
    ]);
  });

  it("matches each layer to its own size in a multi-layer background", () => {
    const layers = buildFillLayersFromComputedStyle(
      "rgba(0, 0, 0, 0)",
      `${url}, ${url}`,
      "contain, cover",
    );
    expect(layers.map((l) => (l as { fit: string }).fit)).toEqual([
      "contain",
      "cover",
    ]);
  });
});

describe("a CROP background at a non-zero origin", () => {
  // Figma's CROP reaches the DOM as an explicit `background-size` plus a
  // `background-position` offset. It is placed with a `userSpaceOnUse` pattern
  // whose TILE sits at the layer's own origin; SVG pattern content is
  // tile-relative, verified against Chromium — a tile at (100, 100) holding an
  // `<image>` at x=0 paints, it does not come out blank. So the image carries
  // only the background-position offset, never the layer origin as well.
  it("puts the tile at the layer origin and the image at the offset", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Cropped",
      kind: "box",
      rect: { x: 240, y: 180, width: 320, height: 200 },
      fills: [
        {
          kind: "image",
          href: "https://img.example/a.png",
          fit: "stretch",
          sizePx: { width: 640, height: 400 },
          offsetPx: { x: -80, y: -30 },
        },
      ],
    };
    const { svg } = buildFigmaSvgDocument({ width: 900, height: 600, root });

    expect(svg).toContain(
      '<pattern id="img-fill-1" patternUnits="userSpaceOnUse" x="240" y="180" width="320" height="200">',
    );
    expect(svg).toContain(
      '<image href="https://img.example/a.png" x="-80" y="-30" width="640" height="400" preserveAspectRatio="none"/>',
    );
    // The layer origin must NOT be added to the image as well.
    expect(svg).not.toContain(
      '<image href="https://img.example/a.png" x="160"',
    );
  });
});

describe("a skewed layer on export", () => {
  // A rotation alone cannot express a skew: the box exported as a plain
  // rectangle where the design drew a parallelogram.
  it("emits the skew alongside the rotation", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Skewed",
      kind: "box",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      reflection: [1, 0, -0.2126, 1],
      fills: [{ kind: "solid", color: "#ffffff" }],
    };
    const { svg } = buildFigmaSvgDocument({ width: 400, height: 300, root });
    expect(svg).toContain(
      'transform="translate(100 50) matrix(1 0 -0.213 1 0 0) translate(-100 -50)"',
    );
  });
});

describe("a mirrored layer on export", () => {
  // `rotationFromTransform` reduces a matrix to `atan2(b, a)`, which reads
  // `matrix(-1, 0, 0, 1)` as 180 degrees — so a mirror exported as a half turn.
  // The two are identical on a symmetric shape and wrong on every other one,
  // and Positivus alone carries 11 of them.
  it("emits the reflection alongside the rotation", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Mirrored",
      kind: "box",
      rect: { x: 100, y: 50, width: 200, height: 100 },
      rotationDeg: 180,
      reflection: [1, 0, 0, -1],
      fills: [{ kind: "solid", color: "#ffffff" }],
    };
    const { svg } = buildFigmaSvgDocument({ width: 400, height: 300, root });

    // Rotation first in the string, so SVG applies the reflection first: the
    // pair composes back to the original matrix about the rect centre.
    expect(svg).toContain(
      'transform="rotate(180 200 100) translate(200 100) matrix(1 0 0 -1 0 0) translate(-200 -100)"',
    );
  });

  it("leaves an unmirrored layer on a plain rotation", () => {
    const root: FigmaSvgNode = {
      id: "root",
      name: "Rotated",
      kind: "box",
      rect: { x: 100, y: 50, width: 200, height: 100 },
      rotationDeg: 180,
      fills: [{ kind: "solid", color: "#ffffff" }],
    };
    const { svg } = buildFigmaSvgDocument({ width: 400, height: 300, root });
    expect(svg).toContain('transform="rotate(180 200 100)"');
    expect(svg).not.toContain("matrix(");
  });
});
