import { describe, expect, it } from "vitest";

import {
  assertFigmaNodeTreeComplexity,
  collectFallbackNodeIds,
  collectImageFillRefs,
  gradientAngleDegrees,
  mapFigmaNodeToHtml,
  type FigmaNode,
  type FigmaPaint,
} from "./figma-node-to-html";

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

describe("gradientAngleDegrees", () => {
  it("resolves the identity left-to-right handles to 90deg (CSS 'to right')", () => {
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

  it("resolves top-to-bottom handles to 180deg (CSS 'to bottom')", () => {
    const paint: FigmaPaint = {
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
        { x: 1, y: 0 },
      ],
      gradientStops: [],
    };
    expect(gradientAngleDegrees(paint, { width: 200, height: 100 })).toBe(180);
  });

  it("resolves a top-left-to-bottom-right diagonal on a square box to 135deg", () => {
    const paint: FigmaPaint = {
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ],
      gradientStops: [],
    };
    expect(gradientAngleDegrees(paint, { width: 100, height: 100 })).toBe(135);
  });

  it("corrects for a non-square box instead of using the raw normalized angle", () => {
    // A tall, narrow box: the normalized diagonal (0,0)->(1,1) is NOT 45deg
    // in real pixel space here, so the derived CSS angle must differ from
    // the naive 135deg square-box answer.
    const paint: FigmaPaint = {
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ],
      gradientStops: [],
    };
    const angle = gradientAngleDegrees(paint, { width: 50, height: 200 });
    expect(angle).not.toBe(135);
    // Figma's gradient parameter is linear in NORMALIZED space, so the CSS
    // angle follows the iso-line normal grad(t) = (du/w, dv/h) -- scaled to
    // (du*h, dv*w) = (200, 50): atan2(50, 200) ~= 14.04 -> +90 ~= 104.04.
    // Scaling the handle vector instead gives 165.96deg, which is what this
    // mapper emitted until a least-squares plane fit of Figma's own render
    // measured 27.0deg where that model predicted 65.7deg.
    expect(angle).toBeCloseTo(104.04, 1);
  });

  it("returns null when gradientHandlePositions is missing", () => {
    expect(
      gradientAngleDegrees(
        { type: "GRADIENT_LINEAR" },
        { width: 10, height: 10 },
      ),
    ).toBeNull();
  });
});

describe("mapFigmaNodeToHtml - basic shapes", () => {
  it("maps a solid-filled rectangle with exact position/size and per-corner radii", () => {
    const root: FigmaNode = {
      id: "1:1",
      name: "Card",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 300, 200),
      children: [
        {
          id: "1:2",
          name: "Rect",
          type: "RECTANGLE",
          absoluteBoundingBox: box(20, 30, 100, 50),
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
          rectangleCornerRadii: [4, 8, 12, 16],
        },
      ],
    };
    const { html, fidelity } = mapFigmaNodeToHtml(root);
    expect(html).toContain("left: 20px; top: 30px; width: 100px; height: 50px");
    expect(html).toContain("background-color: rgba(255, 0, 0, 1)");
    expect(html).toContain("border-radius: 4px 8px 12px 16px");
    expect(fidelity.summary.imageFallback).toBe(0);
    expect(fidelity.entries.find((e) => e.nodeId === "1:2")?.level).toBe(
      "exact",
    );
  });

  it("maps an ellipse to border-radius: 50%", () => {
    const root: FigmaNode = {
      id: "1:1",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "1:3",
          type: "ELLIPSE",
          absoluteBoundingBox: box(0, 0, 40, 40),
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("border-radius: 50%");
  });
});

describe("mapFigmaNodeToHtml - strokes", () => {
  const baseNode = (strokeAlign: FigmaNode["strokeAlign"]): FigmaNode => ({
    id: "2:1",
    type: "RECTANGLE",
    absoluteBoundingBox: box(0, 0, 50, 50),
    strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    strokeWeight: 4,
    strokeAlign,
  });

  it("renders CENTER stroke as outline with a negative half-weight offset", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [baseNode("CENTER")],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("outline: 4px solid rgba(0, 0, 0, 1)");
    expect(html).toContain("outline-offset: -2px");
  });

  it("renders INSIDE stroke as an inset box-shadow", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [baseNode("INSIDE")],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("box-shadow: inset 0 0 0 4px rgba(0, 0, 0, 1)");
  });

  it("renders OUTSIDE stroke as an outline with zero offset", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [baseNode("OUTSIDE")],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("outline: 4px solid rgba(0, 0, 0, 1)");
    expect(html).toContain("outline-offset: 0px");
  });

  it("renders per-side stroke weights as per-side borders and marks non-INSIDE as approximated", () => {
    const node: FigmaNode = {
      id: "2:2",
      type: "RECTANGLE",
      absoluteBoundingBox: box(0, 0, 50, 50),
      strokes: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      strokeAlign: "CENTER",
      individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 },
    };
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [node],
    };
    const { html, fidelity } = mapFigmaNodeToHtml(root);
    expect(html).toContain("border-top: 1px solid");
    expect(html).toContain("border-right: 2px solid");
    expect(html).toContain("border-bottom: 3px solid");
    expect(html).toContain("border-left: 4px solid");
    expect(fidelity.entries.find((e) => e.nodeId === "2:2")?.level).toBe(
      "approximated",
    );
  });
});

describe("mapFigmaNodeToHtml - text", () => {
  it("resolves lineHeightPercentFontSize to an exact px value", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 100),
      children: [
        {
          id: "3:1",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 200, 40),
          characters: "Hello",
          style: {
            fontFamily: "Inter",
            fontSize: 20,
            fontWeight: 600,
            lineHeightPercentFontSize: 150,
            letterSpacing: 0.5,
            textCase: "UPPER",
            textDecoration: "UNDERLINE",
            textAlignHorizontal: "CENTER",
          },
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    // 20 * 150 / 100 = 30px
    expect(html).toContain("line-height: 30px");
    expect(html).toContain("letter-spacing: 0.5px");
    expect(html).toContain("text-transform: uppercase");
    expect(html).toContain("text-decoration: underline");
    expect(html).toContain("text-align: center");
    expect(html).toContain("font-weight: 600");
    expect(html).toContain(">Hello<");
  });

  it("uses lineHeightPx directly when lineHeightUnit is PIXELS", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 100),
      children: [
        {
          id: "3:2",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 200, 40),
          characters: "Fixed",
          style: {
            fontFamily: "Inter",
            fontSize: 16,
            lineHeightPx: 24,
            lineHeightUnit: "PIXELS",
          },
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("line-height: 24px");
  });

  it("preserves explicit newlines, repeated spaces, and mixed character style runs", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 240, 100),
      children: [
        {
          id: "3:3",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 240, 60),
          characters: "A  B\nC",
          style: { fontFamily: "Inter", fontSize: 16, fontWeight: 400 },
          characterStyleOverrides: [1, 1, 0, 0, 2, 2],
          styleOverrideTable: {
            "1": { fontWeight: 700 },
            "2": {
              italic: true,
              fills: [
                {
                  type: "SOLID",
                  color: { r: 1, g: 0, b: 0, a: 1 },
                },
              ],
            },
          },
        },
      ],
    };

    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain('style="font-weight: 700">A ');
    expect(html).toContain("font-style: italic");
    expect(html).toContain("color: rgba(255, 0, 0, 1)");
    expect(html).toContain(">\nC</span>");
  });
});

describe("mapFigmaNodeToHtml - auto layout", () => {
  it("maps layoutMode/itemSpacing/padding/alignment to flexbox", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 100),
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      itemSpacing: 16,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      children: [
        {
          id: "4:1",
          type: "RECTANGLE",
          absoluteBoundingBox: box(8, 4, 50, 92),
          layoutSizingHorizontal: "FIXED",
          fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
        },
        {
          id: "4:2",
          type: "RECTANGLE",
          absoluteBoundingBox: box(74, 4, 50, 92),
          layoutSizingHorizontal: "FILL",
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("display: flex");
    expect(html).toContain("flex-direction: row");
    expect(html).toContain("justify-content: space-between");
    expect(html).toContain("align-items: center");
    expect(html).toContain("column-gap: 16px");
    expect(html).toContain("padding: 4px 8px 4px 8px");
    // Auto-layout children are flex items: no manual left/top.
    expect(html).not.toMatch(/data-figma-node-id="4:1"[^>]*left:/);
    // FILL sizing child grows along the main axis.
    expect(html).toContain("flex-grow: 1");
  });

  it("keeps layoutPositioning ABSOLUTE children out of auto-layout flow", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(100, 100, 400, 200),
      layoutMode: "HORIZONTAL",
      children: [
        {
          id: "4:absolute",
          type: "RECTANGLE",
          layoutPositioning: "ABSOLUTE",
          absoluteBoundingBox: box(420, 120, 40, 40),
        },
      ],
    };

    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toMatch(
      /data-figma-node-id="4:absolute"[^>]*position: absolute/,
    );
    expect(html).toMatch(/data-figma-node-id="4:absolute"[^>]*left: 320px/);
    expect(html).toMatch(/data-figma-node-id="4:absolute"[^>]*top: 20px/);
  });

  it("maps horizontal FILL sizing to align-self: stretch (not flex-grow) under a VERTICAL (column) parent", () => {
    // Regression test: a column auto-layout frame's main axis is vertical, so
    // a child with layoutSizingHorizontal: "FILL" wants to stretch across the
    // cross axis (align-self: stretch), not grow along the main axis
    // (flex-grow/flex-basis). The old implementation ignored the parent's
    // layoutMode and always mapped horizontal-FILL to flex-grow, which left
    // `width: auto` with no stretch on column children -- they sized to
    // content and overflowed the frame instead of filling its width.
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 300),
      layoutMode: "VERTICAL",
      itemSpacing: 16,
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 24,
      paddingBottom: 24,
      children: [
        {
          id: "1:3",
          type: "TEXT",
          absoluteBoundingBox: box(24, 24, 352, 24),
          layoutSizingHorizontal: "FILL",
          style: { fontFamily: "Inter", fontSize: 20 },
          characters: "Heading",
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("flex-direction: column");
    expect(html).toContain("align-self: stretch");
    expect(html).not.toContain("flex-grow: 1");
    expect(html).not.toContain("flex-basis: 0%");
  });

  it("still maps vertical FILL sizing to flex-grow under a VERTICAL (column) parent", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 300),
      layoutMode: "VERTICAL",
      children: [
        {
          id: "4:1",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 352, 100),
          layoutSizingVertical: "FILL",
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    // Vertical FILL under a column parent grows along the (vertical) main
    // axis.
    expect(html).toContain("flex-grow: 1");
    expect(html).toContain("flex-basis: 0%");
    expect(html).not.toContain("align-self: stretch");
  });
});

describe("mapFigmaNodeToHtml - fills layering", () => {
  it("reverses fill stack order so the topmost Figma fill is the topmost CSS layer", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "5:1",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 100, 100),
          fills: [
            { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }, // bottom
            {
              type: "GRADIENT_LINEAR",
              gradientHandlePositions: [
                { x: 0, y: 0.5 },
                { x: 1, y: 0.5 },
                { x: 1, y: 0 },
              ],
              gradientStops: [
                { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
                { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
              ],
            }, // top
          ],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    // The gradient (top layer in Figma) must be the first background-image
    // value, and the solid becomes the plain background-color underneath.
    expect(html).toContain("background-image: linear-gradient(90deg,");
    expect(html).toContain("background-color: rgba(255, 0, 0, 1)");
  });

  it("resolves an IMAGE fill via the provided imageFillUrls map and scale mode", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "5:2",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 100, 100),
          fills: [{ type: "IMAGE", imageRef: "hash-1", scaleMode: "FILL" }],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root, {
      imageFillUrls: { "hash-1": "https://example.com/img.png" },
    });
    // The rendered `style="..."` attribute HTML-escapes embedded quotes (the
    // CSS `url("...")` quoting is legitimate CSS but would otherwise
    // prematurely terminate the surrounding double-quoted HTML attribute --
    // see the styleAttr() doc comment). A real browser parses `&quot;` back
    // to `"` before CSS parsing, so this remains a valid quoted url().
    expect(html).toContain("url(&quot;https://example.com/img.png&quot;)");
    expect(html).toContain("background-size: cover");
  });

  it('escapes embedded double quotes in the style attribute so a font-family value like "Inter" doesn\'t truncate the attribute (regression: silently dropped every style after font-family)', () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: "1:3",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 200, 24),
          style: { fontFamily: "Inter", fontSize: 20 },
          characters: "Heading",
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    // The style attribute must not contain a bare, unescaped `"` -- every
    // quote inside the attribute value has to be `&quot;`.
    const styleAttrMatch = html.match(/style="([^"]*(?:&quot;[^"]*)*)"/g);
    expect(styleAttrMatch).not.toBeNull();
    // Every style="..." attribute's raw content is `&quot;`-escaped, not a
    // literal quote -- if font-family's `"Inter"` leaked through unescaped,
    // the regex above would fail to capture the whole attribute (it would
    // terminate early) and the assertion below would catch the literal `"`.
    expect(html).toContain("font-family: &quot;Inter&quot;, sans-serif");
    expect(html).not.toMatch(/style="[^"]*font-family: "Inter"/);
    // The properties declared AFTER font-family in object-key order must
    // still be present and inside the same attribute -- this is exactly
    // what silently disappeared before the fix.
    expect(html).toContain("font-size: 20px");
    expect(html).toContain("display: flex");
  });
});

describe("mapFigmaNodeToHtml - effects and blend modes", () => {
  it("maps DROP_SHADOW to box-shadow and marks LAYER_BLUR as approximated", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "6:1",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 50, 50),
          effects: [
            {
              type: "DROP_SHADOW",
              offset: { x: 2, y: 4 },
              radius: 8,
              spread: 1,
              color: { r: 0, g: 0, b: 0, a: 0.5 },
            },
            { type: "LAYER_BLUR", radius: 6 },
          ],
        },
      ],
    };
    const { html, fidelity } = mapFigmaNodeToHtml(root);
    expect(html).toContain("box-shadow: 2px 4px 8px 1px rgba(0, 0, 0, 0.5)");
    // A Figma blur radius is not a CSS blur() standard deviation: 6 * 0.45.
    // See FIGMA_BLUR_RADIUS_TO_CSS_BLUR for how that factor was measured.
    expect(html).toContain("filter: blur(2.7px)");
    const entry = fidelity.entries.find((e) => e.nodeId === "6:1");
    expect(entry?.level).toBe("approximated");
  });

  it("maps a CSS-supported blend mode exactly and a Figma-only mode to its closest fallback", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "7:1",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 50, 50),
          blendMode: "MULTIPLY",
        },
        {
          id: "7:2",
          type: "RECTANGLE",
          absoluteBoundingBox: box(50, 0, 50, 50),
          blendMode: "LINEAR_DODGE",
        },
      ],
    };
    const { html, fidelity } = mapFigmaNodeToHtml(root);
    expect(html).toContain("mix-blend-mode: multiply");
    expect(html).toContain("mix-blend-mode: plus-lighter");
    expect(fidelity.entries.find((e) => e.nodeId === "7:2")?.level).toBe(
      "approximated",
    );
  });
});

describe("mapFigmaNodeToHtml - image fallback", () => {
  it("renders an unsupported node type (VECTOR) as an <img> using the fallback image URL", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "8:1",
          name: "Icon",
          type: "VECTOR",
          absoluteBoundingBox: box(10, 10, 24, 24),
        },
      ],
    };
    const { html, fidelity } = mapFigmaNodeToHtml(root, {
      fallbackImageUrls: { "8:1": "https://example.com/render.png" },
    });
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/render.png"');
    expect(html).toContain("left: 10px; top: 10px; width: 24px; height: 24px");
    expect(fidelity.entries.find((e) => e.nodeId === "8:1")?.level).toBe(
      "image-fallback",
    );
  });

  it("renders nothing (and records image-fallback) when no fallback URL is available", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "8:2",
          type: "BOOLEAN_OPERATION",
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
      ],
    };
    const { html, fidelity } = mapFigmaNodeToHtml(root);
    expect(html).not.toContain("<img");
    expect(fidelity.entries.find((e) => e.nodeId === "8:2")?.level).toBe(
      "image-fallback",
    );
  });

  it.each([
    {
      label: "line geometry",
      node: { id: "line", type: "LINE" },
    },
    {
      label: "partial ellipse geometry",
      node: {
        id: "arc",
        type: "ELLIPSE",
        arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.4 },
      },
    },
    {
      label: "dashed stroke",
      node: {
        id: "dashes",
        type: "RECTANGLE",
        strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
        strokeDashes: [4, 2],
      },
    },
    {
      label: "transformed image crop",
      node: {
        id: "crop",
        type: "RECTANGLE",
        fills: [
          {
            type: "IMAGE",
            imageRef: "image",
            imageTransform: [
              [1, 0.2, 0],
              [0, 1, 0],
            ],
          },
        ],
      },
    },
    {
      label: "advanced list typography",
      node: {
        id: "rich-text",
        type: "TEXT",
        characters: "One\nTwo",
        style: { fontFamily: "Inter", fontSize: 16, paragraphSpacing: 8 },
        lineTypes: ["ORDERED", "ORDERED"],
        lineIndentations: [0, 1],
      },
    },
  ])(
    "renders $label as a visual fallback instead of incorrect HTML",
    ({ node }) => {
      const typedNode = {
        ...node,
        absoluteBoundingBox: box(10, 10, 40, 20),
      } as FigmaNode;
      const root: FigmaNode = {
        id: "root",
        type: "FRAME",
        absoluteBoundingBox: box(0, 0, 100, 100),
        children: [typedNode],
      };
      expect(collectFallbackNodeIds(root)).toEqual([typedNode.id]);
      const { html, fidelity } = mapFigmaNodeToHtml(root, {
        fallbackImageUrls: {
          [typedNode.id]: `https://assets.example.test/${typedNode.id}.png`,
        },
      });
      expect(html).toContain(`<img data-figma-node-id="${typedNode.id}"`);
      expect(
        fidelity.entries.find((entry) => entry.nodeId === typedNode.id)?.level,
      ).toBe("image-fallback");
    },
  );

  it("renders the smallest containing mask subtree as one fallback", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      children: [
        {
          id: "masked-group",
          type: "GROUP",
          children: [
            { id: "mask", type: "ELLIPSE", isMask: true },
            { id: "masked-photo", type: "RECTANGLE" },
          ],
        },
        { id: "editable-sibling", type: "RECTANGLE" },
      ],
    };
    expect(collectFallbackNodeIds(root)).toEqual(["masked-group"]);
  });

  it("does not fetch fallbacks or image fills for fully transparent subtrees", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      children: [
        {
          id: "transparent-vector",
          type: "VECTOR",
          opacity: 0,
          fills: [{ type: "IMAGE", imageRef: "unused" }],
        },
      ],
    };
    expect(collectFallbackNodeIds(root)).toEqual([]);
    expect(collectImageFillRefs(root)).toEqual([]);
  });
});

describe("mapFigmaNodeToHtml - vector geometry", () => {
  function vectorNode(overrides: Partial<FigmaNode> = {}): FigmaNode {
    return {
      id: "9:1",
      name: "Logo",
      type: "VECTOR",
      absoluteBoundingBox: box(10, 20, 40, 40),
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      fillGeometry: [{ path: "M0 0 L40 0 L40 40 Z", windingRule: "NONZERO" }],
      ...overrides,
    };
  }

  function frameWith(child: FigmaNode): FigmaNode {
    return {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [child],
    };
  }

  it("draws a VECTOR with fillGeometry as a real <path>, not a rendered PNG", () => {
    const root = frameWith(vectorNode());
    // Nothing to rasterize, so no PNG render is requested for it either.
    expect(collectFallbackNodeIds(root)).toEqual([]);

    const { html, fidelity } = mapFigmaNodeToHtml(root, {
      fallbackImageUrls: { "9:1": "https://example.test/render.png" },
    });
    expect(html).toContain("<svg");
    expect(html).toContain('d="M0 0 L40 0 L40 40 Z"');
    expect(html).toContain('fill="rgba(255, 0, 0, 1)"');
    expect(html).toContain('viewBox="0 0 40 40"');
    expect(html).not.toContain("<img");
    expect(
      fidelity.entries.find((entry) => entry.nodeId === "9:1")?.level,
    ).toBe("exact");
  });

  it("maps the EVENODD winding rule to fill-rule: evenodd (and NONZERO to nonzero)", () => {
    const evenOdd = mapFigmaNodeToHtml(
      frameWith(
        vectorNode({
          fillGeometry: [{ path: "M0 0 L40 40 Z", windingRule: "EVENODD" }],
        }),
      ),
    ).html;
    expect(evenOdd).toContain('fill-rule="evenodd"');

    const nonZero = mapFigmaNodeToHtml(frameWith(vectorNode())).html;
    expect(nonZero).toContain('fill-rule="nonzero"');
  });

  it("emits an SVG gradient def for a gradient-filled vector", () => {
    const { html, fidelity } = mapFigmaNodeToHtml(
      frameWith(
        vectorNode({
          fills: [
            {
              type: "GRADIENT_LINEAR",
              gradientHandlePositions: [
                { x: 0, y: 0.5 },
                { x: 1, y: 0.5 },
                { x: 0, y: 0 },
              ],
              gradientStops: [
                { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
                { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
              ],
            },
          ],
        }),
      ),
    );
    expect(html).toContain("<defs>");
    expect(html).toContain('<linearGradient id="fg-9-1-fill-0-0"');
    // Figma handle positions are already objectBoundingBox space, so they go
    // straight onto x1/y1/x2/y2 with no angle derivation.
    expect(html).toContain('x1="0" y1="0.5" x2="1" y2="0.5"');
    expect(html).toContain('stop-color="rgb(0, 0, 255)" stop-opacity="0.5"');
    expect(html).toContain('fill="url(#fg-9-1-fill-0-0)"');
    expect(
      fidelity.entries.find((entry) => entry.nodeId === "9:1")?.level,
    ).toBe("exact");
  });

  it("fills strokeGeometry (Figma returns the stroke already outlined) with the stroke paint", () => {
    const { html } = mapFigmaNodeToHtml(
      frameWith(
        vectorNode({
          strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokeWeight: 2,
          strokeGeometry: [{ path: "M0 0 L40 0", windingRule: "NONZERO" }],
        }),
      ),
    );
    expect(html).toContain('d="M0 0 L40 0" fill="rgba(0, 0, 0, 1)"');
    expect(html).not.toContain("stroke-width");
  });

  it("still falls back to the rendered image when a vector has no geometry", () => {
    const root = frameWith(
      vectorNode({ fillGeometry: undefined, strokeGeometry: undefined }),
    );
    expect(collectFallbackNodeIds(root)).toEqual(["9:1"]);

    const { html, fidelity } = mapFigmaNodeToHtml(root, {
      fallbackImageUrls: { "9:1": "https://example.test/render.png" },
    });
    expect(html).toContain("<img");
    expect(html).not.toContain("<svg");
    expect(
      fidelity.entries.find((entry) => entry.nodeId === "9:1")?.level,
    ).toBe("image-fallback");
  });

  it("keeps rasterizing a vector whose paint SVG cannot express (image fill, conic gradient)", () => {
    for (const fills of [
      [{ type: "IMAGE", imageRef: "abc" }] as FigmaPaint[],
      [{ type: "GRADIENT_ANGULAR", gradientStops: [] }] as FigmaPaint[],
    ]) {
      expect(collectFallbackNodeIds(frameWith(vectorNode({ fills })))).toEqual([
        "9:1",
      ]);
    }
  });

  it("renders a BOOLEAN_OPERATION's flattened geometry without also rendering its operands", () => {
    const root = frameWith(
      vectorNode({
        type: "BOOLEAN_OPERATION",
        children: [
          {
            id: "9:2",
            type: "VECTOR",
            absoluteBoundingBox: box(10, 20, 10, 10),
          },
        ],
      }),
    );
    expect(collectFallbackNodeIds(root)).toEqual([]);
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain('d="M0 0 L40 0 L40 40 Z"');
    expect(html).not.toContain('data-figma-node-id="9:2"');
  });
});

describe("mapFigmaNodeToHtml - preserved Figma semantics", () => {
  it("keeps bounded component, variable, and interaction metadata inert", () => {
    const root: FigmaNode = {
      id: "instance",
      type: "INSTANCE",
      absoluteBoundingBox: box(0, 0, 320, 80),
      componentId: "12:34",
      componentProperties: { "State#1:0": { type: "VARIANT", value: "Hover" } },
      boundVariables: {
        fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:1:2" }],
      },
      interactions: [
        {
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "URL", url: "https://example.test" }],
        },
      ],
      minWidth: 240,
      maxWidth: 640,
      minHeight: 44,
      maxHeight: 120,
    };

    const { html, fidelity } = mapFigmaNodeToHtml(root);
    expect(html).toContain('data-figma-component-id="12:34"');
    expect(html).toContain("data-figma-component-properties=");
    expect(html).toContain("data-figma-bound-variables=");
    expect(html).toContain("data-figma-interactions=");
    expect(html).not.toContain('href="https://example.test"');
    expect(html).toContain("min-width: 240px");
    expect(html).toContain("max-width: 640px");
    expect(html).toContain("min-height: 44px");
    expect(html).toContain("max-height: 120px");
    expect(
      fidelity.entries.find((entry) => entry.nodeId === "instance")?.level,
    ).toBe("approximated");
  });
});

describe("assertFigmaNodeTreeComplexity", () => {
  it("fails clearly before recursive rendering overflows on adversarial depth", () => {
    const root: FigmaNode = { id: "0", type: "FRAME", children: [] };
    let cursor = root;
    for (let depth = 1; depth <= 257; depth += 1) {
      const child: FigmaNode = {
        id: String(depth),
        type: "FRAME",
        children: [],
      };
      cursor.children = [child];
      cursor = child;
    }
    expect(() => assertFigmaNodeTreeComplexity(root)).toThrow(
      /nested too deeply/i,
    );
    expect(() => mapFigmaNodeToHtml(root)).toThrow(/nested too deeply/i);
  });

  it("rejects cyclic child references", () => {
    const root: FigmaNode = { id: "root", type: "FRAME", children: [] };
    root.children = [root];
    expect(() => assertFigmaNodeTreeComplexity(root)).toThrow(/cyclic/i);
  });
});

describe("collectFallbackNodeIds", () => {
  it("collects ids for vector networks, boolean ops, and unsupported types without recursing into them", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      children: [
        {
          id: "v1",
          type: "VECTOR",
          children: [{ id: "should-not-appear", type: "RECTANGLE" }],
        },
        { id: "b1", type: "BOOLEAN_OPERATION" },
        {
          id: "f1",
          type: "FRAME",
          children: [{ id: "r1", type: "RECTANGLE" }],
        },
      ],
    };
    expect(collectFallbackNodeIds(root)).toEqual(["v1", "b1"]);
  });

  it("skips invisible nodes", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      children: [{ id: "v1", type: "VECTOR", visible: false }],
    };
    expect(collectFallbackNodeIds(root)).toEqual([]);
  });
});

describe("collectImageFillRefs", () => {
  it("collects distinct structural image fills but skips subtrees rendered as fallbacks", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      children: [
        {
          id: "n1",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", imageRef: "hash-a" }],
        },
        {
          id: "n2",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", imageRef: "hash-a" }],
          strokes: [{ type: "IMAGE", imageRef: "hash-b" }],
        },
      ],
    };
    expect(collectFallbackNodeIds(root)).toEqual(["n2"]);
    expect(collectImageFillRefs(root)).toEqual(["hash-a"]);
  });
});

// ---------------------------------------------------------------------------
// Fidelity-harness regressions
//
// Every case below was found by rendering the real Figma corpus frames through
// this mapper and pixel-diffing against Figma's own render
// (`templates/design/scripts/figma-fidelity/run-import.ts`); the measured
// numbers live next to each fix in `figma-node-to-html.ts` /
// `figma-paint-math.ts`.
// ---------------------------------------------------------------------------

describe("mapFigmaNodeToHtml - per-paint opacity and blend mode", () => {
  function styleOf(html: string, nodeId: string): string {
    const match = html.match(
      new RegExp(`data-figma-node-id="${nodeId}"[^>]*style="([^"]*)"`),
    );
    expect(match).not.toBeNull();
    return match![1]!.replace(/&quot;/g, '"');
  }

  it("moves an IMAGE paint with opacity into an overlay div instead of dropping the opacity", () => {
    // CSS background layers have no per-layer opacity, so the alpha cannot be
    // folded in the way it is for SOLID/GRADIENT paints. Dropping it renders a
    // fully saturated image over a muted one -- the `fills-effects` corpus
    // frame's "Multi Fill Stack" node, 28.9% -> 18.7% differing pixels.
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 100),
      children: [
        {
          id: "img",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 200, 100),
          fills: [
            { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
            {
              type: "IMAGE",
              imageRef: "ref-a",
              scaleMode: "FILL",
              opacity: 0.5,
            },
          ],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root, {
      imageFillUrls: { "ref-a": "https://example.test/a.png" },
    });
    expect(html).toContain('data-figma-fill-layer="IMAGE"');
    expect(html).toContain("opacity: 0.5");
    expect(html).toContain("url(&quot;https://example.test/a.png&quot;)");
    // The image must NOT also remain in the node's own background stack.
    expect(styleOf(html, "img")).not.toContain("url(");
    // The solid below it still paints as a plain background-color.
    expect(styleOf(html, "img")).toContain(
      "background-color: rgba(255, 0, 0, 1)",
    );
  });

  it("keeps a fully opaque IMAGE paint in the background stack", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 100),
      children: [
        {
          id: "img",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 200, 100),
          fills: [{ type: "IMAGE", imageRef: "ref-a", scaleMode: "FILL" }],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root, {
      imageFillUrls: { "ref-a": "https://example.test/a.png" },
    });
    expect(html).not.toContain("data-figma-fill-layer");
    expect(styleOf(html, "img")).toContain('url("https://example.test/a.png")');
  });

  it("lifts paints stacked above an opacity-carrying image into overlays too", () => {
    // An overlay div paints above the entire background stack, so a paint that
    // Figma draws ON TOP of the image would sink underneath it if it stayed a
    // background layer.
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 100),
      children: [
        {
          id: "img",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 200, 100),
          fills: [
            { type: "IMAGE", imageRef: "ref-a", opacity: 0.4 },
            { type: "SOLID", color: { r: 0, g: 0, b: 1, a: 0.25 } },
          ],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root, {
      imageFillUrls: { "ref-a": "https://example.test/a.png" },
    });
    const overlays = html.match(/data-figma-fill-layer="(\w+)"/g) ?? [];
    expect(overlays).toEqual([
      'data-figma-fill-layer="IMAGE"',
      'data-figma-fill-layer="SOLID"',
    ]);
    // DOM order is paint order: the image first, the solid on top of it.
    expect(html.indexOf('data-figma-fill-layer="IMAGE"')).toBeLessThan(
      html.indexOf('data-figma-fill-layer="SOLID"'),
    );
    // The lifted SOLID already carries its opacity in the alpha channel, so
    // the div must NOT also set opacity (that would square it to 0.0625).
    const solidOverlay = html.match(
      /data-figma-fill-layer="SOLID" style="([^"]*)"/,
    )![1]!;
    expect(solidOverlay).toContain("rgba(0, 0, 255, 0.25)");
    expect(solidOverlay).not.toContain("opacity");
  });

  it("escalates a node with a per-paint blend mode to an image fallback", () => {
    // CSS `background-blend-mode` would be the obvious mapping, but Figma's
    // paint blend modes compose against the node's backdrop in ways CSS layer
    // blending does not reproduce, so `needsImageFallback` claims these nodes
    // before `buildFills` ever sees them. Asserted here so nobody re-adds a
    // background-blend-mode branch that can never run.
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 200, 100),
      children: [
        {
          id: "blend",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 200, 100),
          fills: [
            { type: "SOLID", color: { r: 1, g: 1, b: 0, a: 1 } },
            {
              type: "SOLID",
              blendMode: "MULTIPLY",
              color: { r: 0, g: 0, b: 1, a: 1 },
            },
          ],
        },
      ],
    };
    const { fidelity } = mapFigmaNodeToHtml(root, {
      fallbackImageUrls: { blend: "https://example.test/blend.png" },
    });
    expect(
      fidelity.entries.find((entry) => entry.nodeId === "blend")?.level,
    ).toBe("image-fallback");
  });
});

describe("mapFigmaNodeToHtml - blur radius scale", () => {
  it("scales BACKGROUND_BLUR by the same fitted factor as LAYER_BLUR", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: "bg",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 50, 50),
          effects: [{ type: "BACKGROUND_BLUR", radius: 12 }],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("backdrop-filter: blur(5.4px)");
  });
});

describe("mapFigmaNodeToHtml - rotation and rotated-parent geometry", () => {
  it("rotates in the same direction Figma does (no sign flip)", () => {
    // relativeTransform's 2x2 IS CSS's [[cos a, -sin a],[sin a, cos a]] in the
    // same y-down space, so the CSS angle is `rotation`, not `-rotation`.
    // Captured from the parity-stress corpus frame's "Rotated Radial" node.
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: "rotated",
          type: "RECTANGLE",
          rotation: -0.2967059779820105, // -17deg, in radians
          size: { x: 190, y: 138 },
          relativeTransform: [
            [0.9563047885894775, 0.2923717200756073, 280],
            [-0.2923717200756073, 0.9563047885894775, 54],
          ],
          absoluteBoundingBox: box(
            344,
            366.4493731856346,
            222.04520720243454,
            187.5206876397133,
          ),
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const match = html.match(/rotate\((-?[\d.]+)deg\)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeCloseTo(-17, 1);
  });

  it("positions a child of a rotated parent in the parent's own unrotated frame", () => {
    // absoluteBoundingBox for such a child is measured in already-rotated
    // absolute space AND inflated to the rotated AABB, so it is wrong twice.
    // Captured from the `shapes` corpus frame: "Rotated Child" is authored
    // 60x30 at (20,20) inside a frame rotated -15deg, but its
    // absoluteBoundingBox reports 65.7x44.5 at (24.5, 29.7).
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(4650, 0, 420, 480),
      size: { x: 420, y: 480 },
      relativeTransform: [
        [1, 0, 4650],
        [0, 1, 0],
      ],
      children: [
        {
          id: "parent",
          type: "FRAME",
          rotation: -0.26179940325453416,
          size: { x: 120, y: 80 },
          relativeTransform: [
            [0.9659258723258972, 0.2588190734386444, 240],
            [-0.2588190734386444, 0.9659258723258972, 30],
          ],
          absoluteBoundingBox: box(
            4890,
            -1.058288812637329,
            136.61663055419922,
            108.3323585987091,
          ),
          children: [
            {
              id: "child",
              type: "RECTANGLE",
              size: { x: 60, y: 30 },
              relativeTransform: [
                [1, 0, 20],
                [0, 1, 20],
              ],
              absoluteBoundingBox: box(
                4914.4951171875,
                28.61299022648211,
                65.7201292147447,
                44.50692524812678,
              ),
            },
          ],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const style = html
      .match(/data-figma-node-id="child"[^>]*style="([^"]*)"/)![1]!
      .replace(/&quot;/g, '"');
    expect(style).toContain("left: 20px");
    expect(style).toContain("top: 20px");
    expect(style).toContain("width: 60px");
    expect(style).toContain("height: 30px");
  });

  it("still un-rotates the AABB when the node carries no relativeTransform/size", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: "aabbOnly",
          type: "FRAME",
          rotation: -0.26179940325453416,
          absoluteBoundingBox: box(
            100,
            0,
            136.61663055419922,
            108.3323585987091,
          ),
          children: [],
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const style = html.match(
      /data-figma-node-id="aabbOnly"[^>]*style="([^"]*)"/,
    )![1]!;
    expect(Number(style.match(/width: ([\d.]+)px/)![1])).toBeCloseTo(120, 0);
    expect(Number(style.match(/height: ([\d.]+)px/)![1])).toBeCloseTo(80, 0);
  });
});

describe("text typography escalation (bug: ordinary labels rasterized)", () => {
  const textNode = (extra: Record<string, unknown>): FigmaNode => ({
    id: "t",
    type: "TEXT",
    characters: "Home",
    absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 24 },
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    style: { fontFamily: "Inter", fontSize: 16, ...extra } as never,
    ...({} as Record<string, never>),
  });

  const render = (node: FigmaNode) =>
    mapFigmaNodeToHtml({
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
      children: [node],
    });

  it("keeps single-paragraph text editable when paragraphSpacing is set", () => {
    // paragraphSpacing is the gap BETWEEN paragraphs, so it cannot affect a
    // one-paragraph node. Design systems set it on every text style anyway: on
    // a real community landing page this rasterized 116 of 146 text nodes, one
    // of them the single word "Home".
    const { html, fidelity } = render(textNode({ paragraphSpacing: 16 }));
    expect(html).toContain("Home");
    expect(html).not.toContain("<img");
    expect(fidelity.summary.imageFallback).toBe(0);
  });

  it("still escalates when the text actually has multiple paragraphs", () => {
    const node = textNode({ paragraphSpacing: 16 });
    node.characters = "First paragraph\nSecond paragraph";
    const { fidelity } = render(node);
    expect(fidelity.summary.imageFallback).toBe(1);
  });

  it("ignores listSpacing on text that is not a list, and honours it when it is", () => {
    expect(
      render(textNode({ listSpacing: 8 })).fidelity.summary.imageFallback,
    ).toBe(0);
    const list = textNode({ listSpacing: 8 });
    list.lineTypes = ["UNORDERED"];
    expect(render(list).fidelity.summary.imageFallback).toBe(1);
  });

  it("still escalates genuinely unrepresentable typography", () => {
    expect(
      render(textNode({ opentypeFlags: { smcp: 1 } })).fidelity.summary
        .imageFallback,
    ).toBe(1);
    expect(
      render(
        textNode({ hyperlink: { type: "URL", url: "https://example.com" } }),
      ).fidelity.summary.imageFallback,
    ).toBe(1);
  });
});

describe("mapFigmaNodeToHtml - TRUNCATE", () => {
  it("puts text-overflow on the span so the ellipsis actually renders", () => {
    // The wrapper div is a flex column (that is how textAlignVertical is
    // reproduced), and `text-overflow` only ellipsizes the inline content of a
    // block container -- on the wrapper it silently clips with no ellipsis.
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 300, 50),
      children: [
        {
          id: "truncated",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 260, 22),
          characters: "This single line is much too long to fit",
          style: { fontSize: 16, textAutoResize: "TRUNCATE" },
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    const span = html.match(/<span style="([^"]*)"/)![1]!;
    expect(span).toContain("text-overflow: ellipsis");
    expect(span).toContain("overflow: hidden");
    expect(span).toContain("display: block");
  });

  it("emits a bare span for non-truncated text", () => {
    const root: FigmaNode = {
      id: "root",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 300, 50),
      children: [
        {
          id: "plain",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 260, 22),
          characters: "Plain",
          style: { fontSize: 16 },
        },
      ],
    };
    const { html } = mapFigmaNodeToHtml(root);
    expect(html).toContain("<span>Plain</span>");
  });
});
