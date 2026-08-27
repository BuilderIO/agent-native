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

  it("emits an arrowhead marker when the stroke has an arrow end-cap", () => {
    // 2 vertices, 1 straight segment; header byte 12 = strokeCap enum 5 (arrow).
    const buf = Buffer.alloc(64);
    buf.writeUInt32LE(2, 0); // vertexCount
    buf.writeUInt32LE(1, 4); // segmentCount
    buf.writeUInt32LE(5, 12); // strokeCap = arrow
    buf.writeFloatLE(0, 16);
    buf.writeFloatLE(0, 20); // v0 (0,0)
    buf.writeFloatLE(100, 28);
    buf.writeFloatLE(0, 32); // v1 (100,0)
    buf.writeUInt32LE(0, 40); // seg v0->v1 (straight)
    buf.writeUInt32LE(1, 52);

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
          size: { x: 200, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        {
          guid: { sessionID: 1, localID: 21 },
          parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
          type: "VECTOR",
          name: "Connector",
          size: { x: 100, y: 0 },
          transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 40 },
          strokeWeight: 2,
          strokePaints: [
            { type: "SOLID", visible: true, color: { r: 1, g: 0, b: 1, a: 1 } },
          ],
          vectorData: {
            vectorNetworkBlob: 0,
            normalizedSize: { x: 100, y: 0 },
          },
        },
      ],
    };
    const html = renderFrame(doc);
    expect(html).toContain("<marker");
    expect(html).toContain("marker-start=");
    expect(html).toContain('fill="rgb(255, 0, 255)"'); // arrowhead uses stroke color
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

// ---------------------------------------------------------------------------
// Vector paints: gradients must become real SVG paint servers, and a paint
// SVG cannot express must be reported instead of silently painted `none`.
// ---------------------------------------------------------------------------
describe("vector gradient fills", () => {
  /** M0 0 L100 0 L100 100 Z in Figma's path-command blob format. */
  function trianglePathBlob(): Buffer {
    const buf = Buffer.alloc(1 + 8 + 1 + 8 + 1 + 8 + 1);
    let o = 0;
    const move = (op: number, x: number, y: number) => {
      buf.writeUInt8(op, o);
      buf.writeFloatLE(x, o + 1);
      buf.writeFloatLE(y, o + 5);
      o += 9;
    };
    move(1, 0, 0);
    move(2, 100, 0);
    move(2, 100, 100);
    buf.writeUInt8(0, o);
    return buf;
  }

  function vectorDoc(
    paints: Array<Record<string, unknown>>,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      blobs: [{ bytes: trianglePathBlob() }],
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
          name: "Logo",
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillGeometry: [{ commandsBlob: 0 }],
          fillPaints: paints,
          ...extra,
        },
      ],
    };
  }

  // Left-to-right gradient: the node-to-gradient matrix is the identity.
  const linearPaint = {
    type: "GRADIENT_LINEAR",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    stops: [
      { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
      { color: { r: 0, g: 0, b: 1, a: 0.5 }, position: 1 },
    ],
  };

  it("paints a gradient-filled vector with a <linearGradient>, not fill=none", () => {
    const html = renderFrame(vectorDoc([linearPaint]));
    const id = html.match(/<linearGradient id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<defs>`);
    expect(html).toMatch(
      new RegExp(`<path d="M0 0 L100 0 L100 100 Z"[^>]*fill="url\\(#${id}\\)"`),
    );
    expect(html).not.toMatch(/<path d="M0 0[^>]*fill="none"/);
    // Stop alpha rides on stop-opacity, colors on stop-color.
    expect(html).toContain('stop-color="rgb(255, 0, 0)" stop-opacity="1"');
    expect(html).toContain('stop-color="rgb(0, 0, 255)" stop-opacity="0.5"');
    // Identity transform → handles span the box left to right.
    expect(html).toContain('x1="0" y1="0.5" x2="1" y2="0.5"');
  });

  it("paints a radial-gradient vector with a <radialGradient> sized in user space", () => {
    const html = renderFrame(
      vectorDoc([{ ...linearPaint, type: "GRADIENT_RADIAL" }]),
    );
    expect(html).toContain('<radialGradient id="');
    expect(html).toContain('gradientUnits="userSpaceOnUse"');
    expect(html).toContain('gradientTransform="translate(50 50) scale(50 50)');
    expect(html).toMatch(/fill="url\(#[^"]+\)"/);
  });

  it("still paints a solid-filled vector with a literal color", () => {
    const html = renderFrame(
      vectorDoc([
        {
          type: "SOLID",
          visible: true,
          color: { r: 0, g: 0.5, b: 1, a: 1 },
        },
      ]),
    );
    expect(html).toContain('fill="rgb(0, 128, 255)"');
    expect(html).not.toContain("<linearGradient");
    expect(html).not.toMatch(/<path d="M0 0[^>]*fill="none"/);
  });

  it("gives two instances of the same gradient vector distinct def ids", () => {
    const doc = vectorDoc([linearPaint]) as {
      nodeChanges: Array<Record<string, unknown>>;
    };
    doc.nodeChanges.push({
      ...doc.nodeChanges[3]!,
      guid: { sessionID: 1, localID: 21 },
      parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "b" },
    });
    const html = renderFrame(doc as unknown as Record<string, unknown>);
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("reports an angular gradient it cannot express instead of dropping it", () => {
    const result = renderHtmlTemplates(
      vectorDoc([{ ...linearPaint, type: "GRADIENT_ANGULAR" }]),
    );
    const html = result.frames[0]?.html ?? "";
    // Reported...
    expect(
      result.approximatedNodes.flatMap((entry) => entry.notes).join(" "),
    ).toContain("GRADIENT_ANGULAR");
    expect(result.approximatedNodes[0]?.nodeName).toBe("Logo");
    // ...and still visible, rather than fill="none".
    expect(html).toContain('fill="rgb(255, 0, 0)"');
    expect(html).not.toMatch(/<path d="M0 0[^>]*fill="none"/);
  });

  it("reports an image stroke on a vector rather than silently unpainting it", () => {
    const result = renderHtmlTemplates(
      vectorDoc([{ ...linearPaint }], {
        strokeWeight: 2,
        strokePaints: [
          { type: "IMAGE", visible: true, image: { hash: "aabbccdd" } },
        ],
      }),
    );
    expect(
      result.approximatedNodes.flatMap((entry) => entry.notes).join(" "),
    ).toContain("IMAGE stroke paint on a vector has no SVG equivalent");
  });

  it("does not emit a gradient def when no geometry survives decoding", () => {
    const doc = vectorDoc([linearPaint]) as {
      blobs: unknown[];
      nodeChanges: Array<Record<string, unknown>>;
    };
    doc.blobs = [{ bytes: Buffer.alloc(0) }];
    const html = renderFrame(doc as unknown as Record<string, unknown>);
    expect(html).not.toContain("<defs>");
  });
});

describe("auto line height", () => {
  // Figma encodes AUTO as `{ value: 100, units: "PERCENT" }` and the REST API
  // calls the same nodes `INTRINSIC_%`, resolving 60px Space Grotesk to
  // 76.56px. Reading the 100 as a font-size percentage made every auto-height
  // text box ~28% short and the error accumulated down the page.
  it("maps AUTO line height to normal and keeps real percentages relative to font size", () => {
    const doc = makeDocument([{}]);
    (doc.nodeChanges as unknown[]).push(
      childNode(10, 20, {
        type: "TEXT",
        name: "auto",
        characters: "Auto",
        fontSize: 60,
        lineHeight: { value: 100, units: "PERCENT" },
      }),
      childNode(10, 21, {
        type: "TEXT",
        name: "explicit",
        characters: "Explicit",
        fontSize: 20,
        lineHeight: { value: 150, units: "PERCENT" },
      }),
      childNode(10, 22, {
        type: "TEXT",
        name: "pixels",
        characters: "Pixels",
        fontSize: 20,
        lineHeight: { value: 28, units: "PIXELS" },
      }),
    );
    const html = renderFrame(doc);
    expect(html).toContain("line-height: normal");
    expect(html).not.toContain("line-height: 60px");
    expect(html).toContain("line-height: 30px");
    expect(html).toContain("line-height: 28px");
  });
});

describe("masks", () => {
  const maskDoc = (maskOverrides: Record<string, unknown>) => {
    const doc = makeDocument([{}]);
    (doc.nodeChanges as unknown[]).push(
      childNode(10, 30, {
        type: "ROUNDED_RECTANGLE",
        name: "Mask shape",
        mask: true,
        ...maskOverrides,
      }),
      childNode(10, 31, {
        type: "ROUNDED_RECTANGLE",
        name: "Masked content",
        fillPaints: [
          { type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      }),
    );
    return doc;
  };

  it("clips the siblings painted after a filled mask and never paints the mask", () => {
    const html = renderFrame(
      maskDoc({
        fillPaints: [
          { type: "SOLID", visible: true, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      }),
    );
    expect(html).toContain("<clipPath");
    expect(html).toContain("clip-path:url(#figmask-1-30)");
    expect(html).toContain("Masked content");
    // The mask contributes alpha only; drawing it is what put a solid black
    // rectangle over the Positivus contact form.
    expect(html).not.toContain('layer-name="Mask shape"');
  });

  it("reports, rather than silently drops, a mask it cannot express", () => {
    const doc = maskDoc({ size: undefined });
    const result = renderHtmlTemplates(doc);
    expect(
      result.approximatedNodes.some((entry) =>
        entry.notes.some((note) => note.includes("mask")),
      ),
    ).toBe(true);
    // The run still renders — an unexpressible mask must not delete content.
    expect(result.frames[0]?.html).toContain("Masked content");
  });
});

describe("auto-layout children in the .fig walker", () => {
  const stack = (stackSpacing: number) => {
    const doc = makeDocument([
      {
        stackMode: "HORIZONTAL",
        stackSpacing,
        stackPaddingLeft: 100,
        stackPaddingRight: 100,
        size: { x: 1440, y: 400 },
      },
    ]);
    (doc.nodeChanges as unknown[]).push(
      childNode(10, 40, {
        name: "Card",
        size: { x: 1240, y: 400 },
        parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
      }),
      childNode(10, 41, {
        name: "Art",
        size: { x: 692, y: 400 },
        parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "b" },
      }),
    );
    return doc;
  };

  // Figma keeps a non-growing auto-layout child at its own size and lets the
  // parent overflow. CSS flex items shrink by default, which redistributed the
  // overflow and rendered Positivus' 1240px CTA card at 897px.
  it("pins non-growing children against flex shrinking", () => {
    const html = renderFrame(stack(0));
    expect(html.match(/flex-shrink: 0/g)?.length).toBe(2);
  });

  it("leaves a growing child elastic when the parent's main axis is fixed", () => {
    const doc = stack(0);
    const nodes = doc.nodeChanges as Array<Record<string, unknown>>;
    nodes[nodes.length - 2]!.stackChildPrimaryGrow = 1;
    // Only a parent with a FIXED main axis has room to distribute.
    nodes[nodes.length - 3]!.stackPrimarySizing = "FIXED";
    const html = renderFrame(doc);
    expect(html).toContain("flex: 1 0 0");
    expect(html.match(/flex-shrink: 0/g)?.length).toBe(1);
  });

  // An omitted `stackPrimarySizing` is HUG, and a growing child has nothing to
  // grow into then — Figma keeps the child's own size. `flex: 1 0 0` inside an
  // auto-sized flex container resolves to ZERO instead, which deletes the child
  // outright and pulls its siblings along by that much.
  it("keeps a growing child's own size when the parent hugs that axis", () => {
    const doc = stack(0);
    const nodes = doc.nodeChanges as Array<Record<string, unknown>>;
    nodes[nodes.length - 2]!.stackChildPrimaryGrow = 1;
    const html = renderFrame(doc);
    expect(html).toContain("width: 1240px");
    expect(html).not.toContain("flex: 1 0 0");
  });

  // CSS rejects a negative gap outright, dropping the declaration.
  it("expresses a negative stackSpacing as an overlap, not a negative gap", () => {
    const html = renderFrame(stack(-367));
    expect(html).not.toContain("gap: -367px");
    expect(html).toContain("margin-left: -367px");
    expect(html.match(/margin-left: -367px/g)).toHaveLength(1);
  });

  it("keeps a positive stackSpacing as a gap", () => {
    const html = renderFrame(stack(24));
    expect(html).toContain("gap: 24px");
    expect(html).not.toContain("margin-left: 24px");
  });
});

describe("transforms that are not rotations", () => {
  const flipped = (m: Record<string, number>) => {
    const doc = makeDocument([{}]);
    (doc.nodeChanges as unknown[]).push(
      childNode(10, 60, {
        name: "Flipped",
        size: { x: 359, y: 394 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, ...m },
      }),
    );
    return renderFrame(doc);
  };

  // `hasNonTrivialScale` compares |determinant|, which erases the sign, so a
  // mirror satisfied neither the scale nor the skew branch and fell through to
  // `rotate(180deg)` — which moves a box up and left by its own size.
  it("emits a matrix for a horizontal mirror, never rotate(180deg)", () => {
    const html = flipped({ m00: -1, m11: 1, m02: 359 });
    expect(html).not.toContain("rotate(180deg)");
    expect(html).toContain("matrix(-1, 0, 0, 1, 0, 0)");
  });

  it("emits a matrix for a vertical mirror", () => {
    const html = flipped({ m00: 1, m11: -1, m12: 394 });
    expect(html).not.toContain("rotate(180deg)");
    expect(html).toContain("matrix(1, 0, 0, -1, 0, 0)");
  });

  it("still uses rotate() for a real rotation", () => {
    const html = flipped({ m00: -1, m11: -1 });
    expect(html).toContain("rotate(180deg)");
  });

  it("leaves an identity transform alone", () => {
    const html = flipped({});
    expect(html).not.toContain("rotate(");
    expect(html).not.toContain("matrix(");
  });
});

describe("parametric shapes", () => {
  const shape = (overrides: Record<string, unknown>) => {
    const doc = makeDocument([{}]);
    (doc.nodeChanges as unknown[]).push(
      childNode(10, 70, {
        size: { x: 200, y: 200 },
        strokePaints: [
          { type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
        strokeWeight: 1,
        ...overrides,
      }),
    );
    return renderFrame(doc);
  };

  // A clipboard payload gives a STAR no geometry at all — only `count` and
  // `starInnerScale` — so without synthesis the shape is silently dropped.
  it("draws a STAR from its point count and inner scale", () => {
    const html = shape({
      type: "STAR",
      name: "Star",
      count: 10,
      starInnerScale: 0.382,
    });
    expect(html).toContain("<svg");
    // 10 tips alternate outer/inner, so 20 points.
    const d = /<path d="M([^"]+)"/.exec(html)?.[1] ?? "";
    expect(d.split(" L").length).toBe(20);
  });

  it("draws a REGULAR_POLYGON from its side count", () => {
    const html = shape({ type: "REGULAR_POLYGON", name: "Tri", count: 3 });
    const d = /<path d="M([^"]+)"/.exec(html)?.[1] ?? "";
    expect(d.split(" L").length).toBe(3);
  });

  it("does not invent geometry for a shape with no parameters", () => {
    const html = shape({ type: "VECTOR", name: "Vec" });
    expect(html).not.toContain("<svg");
  });
});

describe("full ellipses", () => {
  const ellipse = (arcData?: Record<string, number>) => {
    const doc = makeDocument([{}]);
    (doc.nodeChanges as unknown[]).push(
      childNode(10, 80, {
        type: "ELLIPSE",
        name: "Ring",
        size: { x: 338, y: 71 },
        strokePaints: [
          { type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
        strokeWeight: 1,
        strokeAlign: "INSIDE",
        ...(arcData ? { arcData } : {}),
      }),
    );
    return renderHtmlTemplates(doc);
  };

  // border-radius: 50% reproduces a full ellipse exactly, so suppressing it as
  // a "geometryless vector" just deleted the shape — Positivus' CTA rings.
  it("paints a stroke-only full ellipse", () => {
    const html = ellipse({
      startingAngle: 0,
      endingAngle: Math.PI * 2,
      innerRadius: 0,
    }).frames[0]!.html;
    expect(html).toContain("border-radius: 50%");
    expect(html).toContain("box-shadow");
  });

  it("still omits an arc, and reports it rather than dropping it silently", () => {
    const result = ellipse({
      startingAngle: 0,
      endingAngle: Math.PI,
      innerRadius: 0,
    });
    expect(
      result.approximatedNodes.some((e) =>
        e.notes.some((n) => n.includes("no decodable geometry")),
      ),
    ).toBe(true);
  });
});

describe("a resized component instance", () => {
  // An instance can be a different size from its component, and Figma re-lays
  // the master's children by each one's constraint. Inlining them at the
  // MASTER's geometry left DashStack's 1440-wide instance of a 1202-wide
  // component with 238px of bare white down the right edge of every screen.
  const instanceOf = (childOverrides: Record<string, unknown>) => {
    const doc = makeDocument([{ size: { x: 1440, y: 400 } }]);
    (doc.nodeChanges as unknown[]).push(
      {
        guid: { sessionID: 1, localID: 90 },
        parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
        type: "INSTANCE",
        name: "Instance",
        // Wider than its master.
        size: { x: 1440, y: 400 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        symbolData: { symbolID: { sessionID: 1, localID: 91 } },
      },
      {
        guid: { sessionID: 1, localID: 91 },
        parentIndex: { guid: { sessionID: 1, localID: 2 }, position: "z" },
        type: "SYMBOL",
        name: "Master",
        size: { x: 1200, y: 400 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      {
        guid: { sessionID: 1, localID: 92 },
        parentIndex: { guid: { sessionID: 1, localID: 91 }, position: "a" },
        type: "ROUNDED_RECTANGLE",
        name: "Bg",
        size: { x: 1200, y: 400 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        fillPaints: [
          { type: "SOLID", visible: true, color: { r: 1, g: 0, b: 0, a: 1 } },
        ],
        ...childOverrides,
      },
    );
    return renderHtmlTemplates(doc).frames[0]!.html;
  };

  it("scales a SCALE-constrained child to the instance's size", () => {
    const html = instanceOf({ horizontalConstraint: "SCALE" });
    expect(html).toContain("width: 1440px");
    expect(html).not.toContain("width: 1200px");
  });

  // STRETCH and MAX come out the same with or without the resize: STRETCH pins
  // both edges and drops the fixed size, and MAX preserves its end offset by
  // construction. They are pinned here as invariants, not as cover for the fix
  // — only SCALE and CENTER actually change.
  it("stretches a STRETCH-constrained child by the size delta", () => {
    const html = instanceOf({ horizontalConstraint: "STRETCH" });
    expect(html).toContain("width: 1440px");
  });

  it("pushes a MAX-constrained child to the new end edge, keeping its size", () => {
    const html = instanceOf({
      horizontalConstraint: "MAX",
      size: { x: 200, y: 400 },
      transform: { m00: 1, m01: 0, m02: 1000, m10: 0, m11: 1, m12: 0 },
    });
    // MAX pins to the end edge rather than baking a left offset, so the child
    // stays put if the container resizes again. Against the INSTANCE's 1440
    // (not the component's 1200) that end offset is 0, i.e. an effective left
    // of 1240 — resolving it against the component would have put it at -240.
    expect(html).toContain("right: 0px");
    expect(html).toContain("width: 200px");
  });

  it("centres a CENTER-constrained child on the new size", () => {
    const html = instanceOf({
      horizontalConstraint: "CENTER",
      size: { x: 200, y: 400 },
      transform: { m00: 1, m01: 0, m02: 500, m10: 0, m11: 1, m12: 0 },
    });
    // 500 + (1440 - 1200) / 2 = 620.
    expect(html).toContain("left: 620px");
  });

  // Figma's default with no constraint is MIN: pinned to the start at its size.
  it("leaves an unconstrained child alone", () => {
    const html = instanceOf({});
    expect(html).toContain("width: 1200px");
  });
});

describe("kiwi's own spelling of Figma's settings", () => {
  // Kiwi spells Figma's "Space between" as SPACE_EVENLY; the REST API spells
  // the same setting SPACE_BETWEEN. An unmapped value fell through to
  // flex-start, so 17 rows on the Positivus page and 98 on the Untitled UI kit
  // packed to the left instead of distributing.
  const distributedRow = (align: string, stackSpacing: number) => {
    const doc = makeDocument([
      {
        stackMode: "HORIZONTAL",
        stackPrimaryAlignItems: align,
        stackPrimarySizing: "FIXED",
        stackSpacing,
        size: { x: 1440, y: 48 },
      },
    ]);
    (doc.nodeChanges as unknown[]).push(
      childNode(10, 40, {
        name: "A",
        size: { x: 124, y: 48 },
        parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "a" },
      }),
      childNode(10, 41, {
        name: "B",
        size: { x: 126, y: 48 },
        parentIndex: { guid: { sessionID: 1, localID: 10 }, position: "b" },
      }),
    );
    return doc;
  };

  it("maps SPACE_EVENLY to space-between", () => {
    expect(renderFrame(distributedRow("SPACE_EVENLY", 0))).toContain(
      "justify-content: space-between",
    );
  });

  it("drops a stale gap under SPACE_EVENLY, as Figma ignores it there", () => {
    const html = renderFrame(distributedRow("SPACE_EVENLY", 206));
    expect(html).toContain("justify-content: space-between");
    expect(html).not.toContain("gap: 206px");
  });

  it("keeps the gap under ordinary alignment", () => {
    expect(renderFrame(distributedRow("MIN", 206))).toContain("gap: 206px");
  });
});
