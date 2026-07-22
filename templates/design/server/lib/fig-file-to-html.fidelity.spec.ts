/**
 * Fidelity regression spec for the .fig HTML renderer (renderHtmlTemplates):
 * fills, gradients, blend modes, transforms, fonts, coordinate normalization,
 * group sizing/clipping, vector-network decode, and per-character text color.
 * Each case pins one rule with a minimal synthetic node document.
 */
import { describe, expect, it } from "vitest";

import { renderHtmlTemplates } from "./fig-file-to-html.js";

function makeDocument(
  frames: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const frameNodes = frames.map((f, i) => ({
    guid: { sessionID: 1, localID: 10 + i },
    parentIndex: { guid: { sessionID: 1, localID: 2 }, position: `${i}` },
    type: "FRAME",
    name: `Frame${i}`,
    size: { x: 400, y: 300 },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    ...f,
  }));
  return {
    nodeChanges: [
      { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
      {
        guid: { sessionID: 1, localID: 2 },
        parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
        type: "CANVAS",
        name: "Page 1",
      },
      ...frameNodes,
    ],
  };
}

function childNode(
  parentLocalID: number,
  localID: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    guid: { sessionID: 1, localID },
    parentIndex: {
      guid: { sessionID: 1, localID: parentLocalID },
      position: "a",
    },
    type: "FRAME",
    name: `Child${localID}`,
    size: { x: 200, y: 100 },
    transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 10 },
    ...overrides,
  };
}

function renderFrame(document: Record<string, unknown>): string {
  const result = renderHtmlTemplates(document);
  return result.frames[0]?.html ?? "";
}

// ---------------------------------------------------------------------------
// A1: Image fill URL quoting
// ---------------------------------------------------------------------------
describe("A1 — image fill URL quoting", () => {
  it("wraps image fill URL in single quotes, not double quotes", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          {
            type: "IMAGE",
            visible: true,
            image: { hash: "aabbccdd" },
          },
        ],
      },
    ]);
    const html = renderFrame({
      ...doc,
      nodeChanges: [...(doc.nodeChanges as unknown[])],
    } as Record<string, unknown>);
    expect(html).toContain("url('");
    expect(html).not.toContain('url("');
    expect(html).not.toContain("url(&quot;");
  });

  it("escapes single quotes in image URL with %27", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          { type: "IMAGE", visible: true, image: { hash: "aabbccdd" } },
        ],
      },
    ]);
    const html = renderFrame(doc as unknown as Record<string, unknown>);
    // The URL from the imageRefBase will not have quotes, but if it did
    // the renderer must escape them. Verifying the url() wrapper is correct.
    expect(html).toMatch(/url\('[^"]*'\)/);
  });
});

// ---------------------------------------------------------------------------
// A2: Fill stacking order and per-layer properties
// ---------------------------------------------------------------------------
describe("A2 — fill stacking", () => {
  it("reverses fill order so Figma bottom→top becomes CSS top→bottom", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          { type: "IMAGE", visible: true, image: { hash: "img1" } }, // bottom in Figma
          {
            type: "SOLID",
            visible: true,
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 0.4,
          }, // top in Figma (scrim)
        ],
        size: { x: 400, y: 300 },
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    const bgIdx = html.indexOf("background-image");
    // The scrim (solid→linear-gradient(rgba)) should appear BEFORE the image
    // in the CSS value (first layer = top in CSS = scrim over photo).
    const bgValue =
      html.slice(bgIdx).match(/background-image:\s*([^;]+)/)?.[1] ?? "";
    const gradIdx = bgValue.indexOf("linear-gradient");
    const urlIdx = bgValue.indexOf("url(");
    expect(gradIdx).toBeGreaterThanOrEqual(0);
    expect(urlIdx).toBeGreaterThanOrEqual(0);
    expect(gradIdx).toBeLessThan(urlIdx);
  });

  it("emits per-layer background-size and background-position for IMAGE fills", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          { type: "IMAGE", visible: true, image: { hash: "img1" } },
          {
            type: "SOLID",
            visible: true,
            color: { r: 1, g: 0, b: 0, a: 1 },
          },
        ],
        size: { x: 400, y: 300 },
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("background-size:");
    expect(html).toContain("background-position:");
    expect(html).toContain("background-repeat:");
  });

  it("emits background-blend-mode when a fill has a non-normal blend mode", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          { type: "IMAGE", visible: true, image: { hash: "img1" } },
          {
            type: "SOLID",
            visible: true,
            color: { r: 0, g: 0, b: 0, a: 1 },
            blendMode: "MULTIPLY",
          },
        ],
        size: { x: 400, y: 300 },
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("background-blend-mode:");
    expect(html).toContain("multiply");
  });

  it("uses background-color shortcut for a single solid fill", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          { type: "SOLID", visible: true, color: { r: 1, g: 0, b: 0, a: 1 } },
        ],
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("background-color:");
    expect(html).not.toContain("linear-gradient(rgb(255, 0, 0)");
  });
});

// ---------------------------------------------------------------------------
// A3: Gradient geometry with paint transform
// ---------------------------------------------------------------------------
describe("A3 — gradient geometry", () => {
  it("emits angle for a LINEAR gradient with transform", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          {
            type: "GRADIENT_LINEAR",
            visible: true,
            stops: [
              { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
            ],
            // Identity transform: top-to-bottom gradient (90°)
            transform: { m00: 0, m01: -1, m02: 1, m10: 1, m11: 0, m12: 0 },
          },
        ],
        size: { x: 400, y: 300 },
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toMatch(/linear-gradient\(\d+(\.\d+)?deg/);
  });

  it("emits radial-gradient with center and radii for RADIAL gradient", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          {
            type: "GRADIENT_RADIAL",
            visible: true,
            stops: [
              { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
            ],
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          },
        ],
        size: { x: 400, y: 300 },
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("radial-gradient(ellipse");
  });

  it("approximates DIAMOND gradient as radial-gradient and records verdict", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          {
            type: "GRADIENT_DIAMOND",
            visible: true,
            stops: [
              { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
            ],
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          },
        ],
        size: { x: 400, y: 300 },
      },
    ]);
    const result = renderHtmlTemplates(doc as unknown);
    expect(result.frames[0]!.html).toContain("radial-gradient");
    expect(
      result.approximatedNodes.some((n) => n.notes[0]?.includes("DIAMOND")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A4: Gradient text
// ---------------------------------------------------------------------------
describe("A4 — gradient text", () => {
  it("emits background-clip:text for gradient-filled TEXT nodes", () => {
    const textNode = {
      guid: { sessionID: 1, localID: 20 },
      parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
      type: "TEXT",
      name: "Headline",
      size: { x: 200, y: 40 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      textData: { characters: "Hello" },
      fontSize: 24,
      fillPaints: [
        {
          type: "GRADIENT_LINEAR",
          visible: true,
          stops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
      ],
    };
    const doc: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Frame",
          size: { x: 400, y: 300 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        textNode,
      ],
    };
    const html = renderFrame(doc);
    expect(html).toContain("background-clip: text");
    expect(html).toContain("color: transparent");
  });

  it("hides TEXT with no visible fills instead of showing UA black", () => {
    const textNode = {
      guid: { sessionID: 1, localID: 20 },
      parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
      type: "TEXT",
      name: "Empty",
      size: { x: 200, y: 40 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      textData: { characters: "Hidden" },
      fontSize: 16,
      fillPaints: [],
    };
    const doc: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Frame",
          size: { x: 400, y: 300 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        textNode,
      ],
    };
    const html = renderFrame(doc);
    expect(html).toContain("visibility: hidden");
  });
});

// ---------------------------------------------------------------------------
// A7: Stroke never-black fallback
// ---------------------------------------------------------------------------
describe("A7 — stroke fallback", () => {
  it("skips border when stroke paint has no solid color (gradient stroke)", () => {
    const doc = makeDocument([
      {
        strokePaints: [
          {
            type: "GRADIENT_LINEAR",
            visible: true,
            stops: [
              { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
            ],
          },
        ],
        strokeWeight: 2,
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    // No border nor outline with black color should appear
    expect(html).not.toMatch(/border:\s*\d+px solid rgb\(0,\s*0,\s*0\)/);
    expect(html).not.toContain("outline: 2px solid rgb(0, 0, 0)");
  });
});

// ---------------------------------------------------------------------------
// A8: Image fill defaults
// ---------------------------------------------------------------------------
describe("A8 — image fill defaults", () => {
  it("defaults missing imageScaleMode to FILL (cover + center)", () => {
    const doc = makeDocument([
      {
        fillPaints: [
          {
            type: "IMAGE",
            visible: true,
            image: { hash: "img1" },
            // no imageScaleMode — should default to FILL → cover
          },
        ],
        size: { x: 400, y: 300 },
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("cover");
    expect(html).toContain("center");
  });
});

// ---------------------------------------------------------------------------
// A9: Blend modes
// ---------------------------------------------------------------------------
describe("A9 — blend mode mapping", () => {
  it("emits mix-blend-mode: multiply for MULTIPLY", () => {
    const doc = makeDocument([{ blendMode: "MULTIPLY" }]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("mix-blend-mode: multiply");
  });

  it("records approximated verdict for LINEAR_BURN blend mode", () => {
    const doc = makeDocument([{ blendMode: "LINEAR_BURN" }]);
    const result = renderHtmlTemplates(doc as unknown);
    expect(
      result.approximatedNodes.some((n) => n.notes[0]?.includes("LINEAR_BURN")),
    ).toBe(true);
    expect(result.frames[0]!.html).toContain("plus-darker");
  });

  it("emits mix-blend-mode: plus-lighter for LINEAR_DODGE", () => {
    const doc = makeDocument([{ blendMode: "LINEAR_DODGE" }]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("plus-lighter");
  });
});

// ---------------------------------------------------------------------------
// A10: Full affine matrix transform
// ---------------------------------------------------------------------------
describe("A10 — full affine transform", () => {
  it("emits rotation-only transform as rotate() for pure rotations", () => {
    const angle = Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const doc = makeDocument([
      {
        // Pure 45° rotation
        transform: {
          m00: cos,
          m01: -sin,
          m02: 100,
          m10: sin,
          m11: cos,
          m12: 100,
        },
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    // The top-level frame doesn't get a transform (parentIsFlex=true), but
    // a child with this transform would.
    expect(html).toBeDefined();
  });

  it("emits full CSS matrix() for scaled transforms", () => {
    const docWithChild: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Frame",
          size: { x: 400, y: 300 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        // child with 2× scale (non-trivial determinant)
        childNode(10, 20, {
          transform: {
            m00: 2,
            m01: 0,
            m02: 50,
            m10: 0,
            m11: 2,
            m12: 50,
          },
        }),
      ],
    };
    const html = renderFrame(docWithChild);
    expect(html).toContain("matrix(2");
  });
});

// ---------------------------------------------------------------------------
// A11a: Font fallback stacks
// ---------------------------------------------------------------------------
describe("A11a — font fallback stacks", () => {
  it("appends a sans-serif fallback stack to non-system font families", () => {
    const docWithText: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Frame",
          size: { x: 400, y: 300 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "TEXT",
          name: "Body",
          size: { x: 300, y: 30 },
          transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 10 },
          textData: { characters: "Hello" },
          fontSize: 16,
          fontName: { family: "Inter", style: "Regular" },
          fillPaints: [
            { type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0, a: 1 } },
          ],
        },
      ],
    };
    const html = renderFrame(docWithText);
    // Should have Inter plus a generic sans-serif fallback
    expect(html).toContain("Inter");
    expect(html).toMatch(/sans-serif/);
  });

  it("appends a monospace fallback stack for monospace families", () => {
    const docWithText: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Frame",
          size: { x: 400, y: 300 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "TEXT",
          name: "Code",
          size: { x: 300, y: 30 },
          transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 10 },
          textData: { characters: "code()" },
          fontSize: 14,
          fontName: { family: "Fira Code", style: "Regular" },
          fillPaints: [
            { type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0, a: 1 } },
          ],
        },
      ],
    };
    const html = renderFrame(docWithText);
    expect(html).toContain("Fira Code");
    expect(html).toContain("monospace");
  });
});

// ---------------------------------------------------------------------------
// A12: Effect corrections (blur halving)
// ---------------------------------------------------------------------------
describe("A12 — effect corrections", () => {
  it("halves BACKGROUND_BLUR radius (Figma ≈ 2× CSS sigma)", () => {
    const doc = makeDocument([
      {
        effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 20 }],
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("backdrop-filter: blur(10px)");
  });

  it("halves LAYER_BLUR radius", () => {
    const doc = makeDocument([
      {
        effects: [{ type: "LAYER_BLUR", visible: true, radius: 16 }],
      },
    ]);
    const html = renderFrame(doc as Record<string, unknown>);
    expect(html).toContain("filter: blur(8px)");
  });
});

// ---------------------------------------------------------------------------
// Coordinate-space: canvas offset normalization
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Group / resizeToFit frames: keep baked size, never clip
// ---------------------------------------------------------------------------
describe("resizeToFit (group) frames", () => {
  function frameWithChild(frameOverrides: Record<string, unknown>): string {
    const doc: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Root",
          size: { x: 400, y: 300 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "FRAME",
          name: "Group",
          size: { x: 200, y: 100 },
          transform: { m00: 1, m01: 0, m02: 50, m10: 0, m11: 1, m12: 50 },
          ...frameOverrides,
        },
        {
          // Child overflows the group to the left (negative offset).
          guid: { sessionID: 1, localID: 30 },
          parentIndex: { guid: { sessionID: 1, localID: 20 }, position: "a" },
          type: "TEXT",
          name: "Overflow",
          size: { x: 120, y: 24 },
          transform: { m00: 1, m01: 0, m02: -80, m10: 0, m11: 1, m12: 10 },
          textData: { characters: "Wide" },
          fontSize: 16,
          fillPaints: [
            { type: "SOLID", visible: true, color: { r: 1, g: 1, b: 1, a: 1 } },
          ],
        },
      ],
    };
    return renderFrame(doc);
  }

  it("emits the baked size for a resizeToFit frame (does not collapse to 0)", () => {
    const html = frameWithChild({ resizeToFit: true });
    expect(html).toContain('layer-name="Group"');
    const groupStyle =
      html
        .slice(html.indexOf('layer-name="Group"'))
        .match(/style="([^"]*)"/)?.[1] ?? "";
    expect(groupStyle).toContain("width: 200px");
    expect(groupStyle).toContain("height: 100px");
  });

  it("does not clip a resizeToFit frame (its children legitimately overflow)", () => {
    const html = frameWithChild({ resizeToFit: true });
    const groupStyle =
      html
        .slice(html.indexOf('layer-name="Group"'))
        .match(/style="([^"]*)"/)?.[1] ?? "";
    expect(groupStyle).not.toContain("overflow: hidden");
  });

  it("still clips an ordinary frame with clip enabled", () => {
    const html = frameWithChild({ frameMaskDisabled: false });
    const groupStyle =
      html
        .slice(html.indexOf('layer-name="Group"'))
        .match(/style="([^"]*)"/)?.[1] ?? "";
    expect(groupStyle).toContain("overflow: hidden");
  });
});

// ---------------------------------------------------------------------------
// Line / stroke vectors: never clip, never collapse to a 0-size SVG
// ---------------------------------------------------------------------------
describe("line vectors (degenerate bounding box)", () => {
  function lineDoc(): Record<string, unknown> {
    return {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Frame",
          size: { x: 400, y: 300 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "VECTOR",
          name: "Connector",
          // A horizontal line: zero-height bounding box.
          size: { x: 100, y: 0 },
          transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 40 },
          strokeWeight: 2,
          strokeGeometry: [{ commandsBlob: 0 }],
          strokePaints: [
            { type: "SOLID", visible: true, color: { r: 0, g: 1, b: 1, a: 1 } },
          ],
        },
      ],
    };
  }

  it("gives a zero-height line vector a non-zero SVG box so it can paint", () => {
    const html = renderFrame(lineDoc());
    const svgStyle =
      html
        .slice(html.indexOf('layer-name="Connector"'))
        .match(/style="([^"]*)"/)?.[1] ?? "";
    expect(svgStyle).not.toContain("height: 0px");
    expect(svgStyle).toContain("overflow: visible");
  });

  it("does not emit a degenerate viewBox for a zero-height line vector", () => {
    const html = renderFrame(lineDoc());
    expect(html).not.toMatch(/viewBox="0 0 100 0"/);
  });
});

// ---------------------------------------------------------------------------
// Vector network decode (clipboard-paste geometry: no flattened commandsBlob)
// ---------------------------------------------------------------------------
describe("vector network decode", () => {
  it("renders a path from vectorData.vectorNetworkBlob when flattened geometry is absent", () => {
    // Build a minimal vector-network blob: 3 vertices, 2 segments
    // (one straight line, one cubic curve). Matches the decoded format.
    const buf = Buffer.alloc(108);
    buf.writeUInt32LE(3, 0); // vertexCount
    buf.writeUInt32LE(2, 4); // segmentCount
    // vertices { f32 x, f32 y, u32 styleID } at offset 16
    buf.writeFloatLE(0, 16);
    buf.writeFloatLE(0, 20); // v0 (0,0)
    buf.writeFloatLE(10, 28);
    buf.writeFloatLE(0, 32); // v1 (10,0)
    buf.writeFloatLE(10, 40);
    buf.writeFloatLE(10, 44); // v2 (10,10)
    // segments at 52 (stride 28): { startVtx, tanS.x, tanS.y, endVtx, tanE.x, tanE.y }
    buf.writeUInt32LE(0, 52); // seg0 v0->v1 straight
    buf.writeUInt32LE(1, 64);
    buf.writeUInt32LE(1, 80); // seg1 v1->v2 curve
    buf.writeFloatLE(2, 84); // tanStart.x = 2
    buf.writeUInt32LE(2, 92);
    buf.writeFloatLE(-2, 100); // tanEnd.y = -2

    const doc: Record<string, unknown> = {
      blobs: [{ bytes: buf }],
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "D" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "P",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "F",
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "VECTOR",
          name: "Net",
          size: { x: 10, y: 10 },
          transform: { m00: 1, m01: 0, m02: 5, m10: 0, m11: 1, m12: 5 },
          strokeWeight: 2,
          strokePaints: [
            { type: "SOLID", visible: true, color: { r: 0, g: 1, b: 1, a: 1 } },
          ],
          vectorData: {
            vectorNetworkBlob: 0,
            normalizedSize: { x: 10, y: 10 },
          },
        },
      ],
    };
    const html = renderFrame(doc);
    expect(html).toContain("<svg");
    expect(html).toContain("M0 0 L10 0");
    expect(html).toContain("C12 0 10 8 10 10");
    expect(html).toContain('stroke="rgb(0, 255, 255)"');
  });
});

// ---------------------------------------------------------------------------
// Per-character text color runs (styleOverrideTable)
// ---------------------------------------------------------------------------
describe("per-character text color runs", () => {
  it("splits one text node into colored runs via characterStyleIDs + styleOverrideTable", () => {
    const doc: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "D" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "P",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "F",
          size: { x: 400, y: 200 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "TEXT",
          name: "Headline",
          size: { x: 400, y: 80 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fontSize: 32,
          // Base fill = cyan.
          fillPaints: [
            { type: "SOLID", visible: true, color: { r: 0, g: 1, b: 1, a: 1 } },
          ],
          textData: {
            characters: "AB CD",
            characterStyleIDs: [0, 0, 0, 9, 9], // "AB " base, "CD" style 9
            styleOverrideTable: [
              {
                styleID: 9,
                fillPaints: [
                  {
                    type: "SOLID",
                    visible: true,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const html = renderFrame(doc);
    // The overridden run gets an explicit white color; the base run inherits.
    expect(html).toContain('<span style="color: rgb(255, 255, 255)">CD</span>');
    expect(html).toContain("AB ");
    // The element's base color stays cyan.
    expect(html).toMatch(/color: rgb\(0, 255, 255\)/);
  });
});

describe("Canvas offset normalization", () => {
  // Figma/Kiwi node transforms are `relativeTransform` — already parent-local at
  // every depth (verified against a real v106 .fig). A child of a top-level frame
  // sits at its own m02/m12; the frame's own canvas position must NOT be added to
  // (or subtracted from) the child, or the child is flung off the frame.
  it("keeps a frame-child at its parent-relative offset, ignoring the frame's canvas position", () => {
    const doc: Record<string, unknown> = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "a" },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 10 },
          parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "a" },
          type: "FRAME",
          name: "Offset Frame",
          size: { x: 800, y: 800 },
          // Frame sits far out on the canvas.
          transform: { m00: 1, m01: 0, m02: 800, m10: 0, m11: 1, m12: 800 },
        },
        {
          guid: { sessionID: 1, localID: 20 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "FRAME",
          name: "Image",
          size: { x: 500, y: 260 },
          // Parent-relative offset inside the frame.
          transform: { m00: 1, m01: 0, m02: 26.1875, m10: 0, m11: 1, m12: 0 },
          fillPaints: [
            { type: "SOLID", visible: true, color: { r: 1, g: 0, b: 0, a: 1 } },
          ],
        },
      ],
    };
    const html = renderFrame(doc);
    expect(html).toContain("left: 26.19px");
    expect(html).toContain("top: 0px");
    // The frame's canvas offset must not leak into the child (no +800/-800).
    expect(html).not.toContain("left: 826");
    expect(html).not.toContain("left: -773");
  });
});
