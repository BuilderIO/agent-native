/**
 * Auto-layout rules Figma expresses directly and CSS does not. Each case pins a
 * shape that produced a plausible-looking but wrong layout, so a regression
 * shows up here rather than as a design that is subtly the wrong width.
 *
 * These live beside the source because `templates/design` imports core's built
 * `dist`; a spec there cannot see an unbuilt change to this file.
 */
import { describe, expect, it } from "vitest";

import { mapFigmaNodeToHtml, type FigmaNode } from "./figma-node-to-html.js";

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

/** Positivus' contact block: a fixed 1440 row whose children overlap by -367px. */
function overlappingRow(itemSpacing: number): FigmaNode {
  return {
    id: "1:1",
    name: "Row",
    type: "FRAME",
    absoluteBoundingBox: box(0, 0, 1440, 773),
    layoutMode: "HORIZONTAL",
    itemSpacing,
    paddingLeft: 100,
    paddingRight: 100,
    children: [
      {
        id: "1:2",
        name: "Wide",
        type: "FRAME",
        absoluteBoundingBox: box(100, 0, 1240, 773),
        layoutSizingHorizontal: "FIXED",
      },
      {
        id: "1:3",
        name: "Illustration",
        type: "FRAME",
        absoluteBoundingBox: box(973, 0, 692, 648),
        layoutSizingHorizontal: "FIXED",
      },
    ],
  } as FigmaNode;
}

describe("negative itemSpacing", () => {
  // CSS rejects a negative `gap` outright, dropping the declaration and falling
  // back to 0. That overflowed the row and let flex shrink both children from
  // 1240/692 to 825/415, throwing the illustration out of its card.
  it("becomes an overlap on later children, never a negative gap", () => {
    const { html } = mapFigmaNodeToHtml(overlappingRow(-367), {});
    expect(html).not.toContain("column-gap: -367px");
    expect(html).toContain("margin-left: -367px");
    // The first child starts the row; only its siblings overlap backwards.
    expect(html.match(/margin-left: -367px/g)).toHaveLength(1);
  });

  it("keeps a positive itemSpacing as a gap", () => {
    const { html } = mapFigmaNodeToHtml(overlappingRow(24), {});
    expect(html).toContain("column-gap: 24px");
    expect(html).not.toContain("margin-left: 24px");
  });

  it("uses margin-top for a vertical parent", () => {
    const node = overlappingRow(-40);
    node.layoutMode = "VERTICAL";
    node.children![0]!.layoutSizingVertical = "FIXED";
    node.children![1]!.layoutSizingVertical = "FIXED";
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("margin-top: -40px");
    expect(html).not.toContain("row-gap: -40px");
  });
});

describe("auto-layout children do not shrink", () => {
  // Figma keeps a FIXED or HUG child at its own size and lets the parent
  // overflow. A CSS flex item shrinks by default, redistributing the overflow
  // and making every child the wrong width.
  it("pins FIXED children", () => {
    const { html } = mapFigmaNodeToHtml(overlappingRow(-367), {});
    expect(html.match(/flex-shrink: 0/g)).toHaveLength(2);
  });

  it("leaves FILL children elastic", () => {
    const node = overlappingRow(0);
    node.children![0]!.layoutSizingHorizontal = "FILL";
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("flex-grow: 1");
    // Only the FIXED sibling is pinned.
    expect(html.match(/flex-shrink: 0/g)).toHaveLength(1);
  });

  it("does not pin children of a non-auto-layout parent", () => {
    const node = overlappingRow(0);
    node.layoutMode = "NONE";
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).not.toContain("flex-shrink");
  });
});

describe("magnified image fills", () => {
  // Figma upscales an image fill with NEAREST-NEIGHBOUR sampling; a browser
  // upscales with bilinear smoothing. Measured across a checkerboard edge on a
  // 16x16 fill blown up to 180x90, Figma steps from rgb(119,73,132) to
  // rgb(227,78,52) in ONE pixel while the browser ramped across twelve.
  const imageNode = (width: number, height: number): FigmaNode =>
    ({
      id: "1:1",
      name: "Tile",
      type: "RECTANGLE",
      absoluteBoundingBox: box(0, 0, width, height),
      fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc" }],
    }) as FigmaNode;

  const render = (
    width: number,
    height: number,
    sizes?: Record<string, { width: number; height: number }>,
  ) =>
    mapFigmaNodeToHtml(imageNode(width, height), {
      imageFillUrls: { abc: "https://example.com/a.png" },
      ...(sizes ? { imageFillSizes: sizes } : {}),
    }).html;

  it("asks for nearest sampling when the fill is magnified", () => {
    const html = render(180, 90, { abc: { width: 16, height: 16 } });
    expect(html).toContain("image-rendering: pixelated");
  });

  it("leaves a downscaled fill smooth", () => {
    // `pixelated` is nearest in BOTH directions, and a photo scaled down with
    // nearest aliases badly.
    const html = render(180, 90, { abc: { width: 1200, height: 800 } });
    expect(html).not.toContain("image-rendering");
  });

  it("leaves a roughly 1:1 fill smooth", () => {
    const html = render(180, 90, { abc: { width: 176, height: 88 } });
    expect(html).not.toContain("image-rendering");
  });

  // Without a known size the fill must still render — just smoothed.
  it("renders the fill normally when the size is unknown", () => {
    const html = render(180, 90);
    expect(html).toContain("https://example.com/a.png");
    expect(html).not.toContain("image-rendering");
  });
});

describe("a main-axis FILL child whose parent hugs that axis", () => {
  // Figma resolves this degenerate pair by keeping the child's own size: there
  // is nothing to fill when the parent sizes itself to its content. CSS does
  // not — `flex-grow: 1; flex-basis: 0%` in an auto-height column collapses the
  // child to zero. A 343x240 photo on the Untitled UI mobile landing page
  // disappeared that way, and everything below it slid up by 240px.
  function hugColumnWithFillChild(): FigmaNode {
    return {
      id: "1:1",
      name: "Container",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 375, 240),
      layoutMode: "VERTICAL",
      layoutSizingVertical: "HUG",
      children: [
        {
          id: "1:2",
          name: "Image",
          type: "FRAME",
          absoluteBoundingBox: box(16, 0, 343, 240),
          layoutSizingVertical: "FILL",
        },
      ],
    } as FigmaNode;
  }

  it("keeps the resolved height instead of collapsing to zero", () => {
    const { html } = mapFigmaNodeToHtml(hugColumnWithFillChild(), {});
    expect(html).toContain("height: 240px");
    expect(html).not.toContain("flex-basis: 0%");
  });

  it("still grows when the parent's main axis is fixed", () => {
    const node = hugColumnWithFillChild();
    node.layoutSizingVertical = "FIXED";
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("flex-grow: 1");
    expect(html).toContain("flex-basis: 0%");
  });

  it("reads the older primaryAxisSizingMode spelling", () => {
    const node = hugColumnWithFillChild();
    delete node.layoutSizingVertical;
    node.primaryAxisSizingMode = "AUTO";
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("height: 240px");
    expect(html).not.toContain("flex-basis: 0%");
  });
});

describe("diamond gradients", () => {
  // Figma's diamond falloff is an L1 distance (|dx|/rx + |dy|/ry), which draws
  // a four-pointed star. A radial-gradient draws the L2 blob instead, and that
  // one tile was 12% of the whole fills/effects fixture. The L1 expression is
  // linear inside each quadrant, so four quadrant-tiled linear gradients are
  // the exact shape rather than an approximation.
  function diamondNode(): FigmaNode {
    return {
      id: "1:1",
      name: "Diamond",
      type: "RECTANGLE",
      absoluteBoundingBox: box(0, 0, 200, 100),
      fills: [
        {
          type: "GRADIENT_DIAMOND",
          gradientHandlePositions: [
            { x: 0.5, y: 0.5 },
            { x: 1, y: 0.5 },
            { x: 0.5, y: 1 },
          ],
          gradientStops: [
            { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
          ],
        },
      ],
    } as FigmaNode;
  }

  it("emits four quadrant tiles plus a clamp layer, not a radial-gradient", () => {
    const { html } = mapFigmaNodeToHtml(diamondNode(), {});
    expect(html).not.toContain("radial-gradient");
    expect(html.match(/linear-gradient/g)?.length).toBe(5);
  });

  it("halves the stop offsets so the ramp ends at the diamond's points", () => {
    const { html } = mapFigmaNodeToHtml(diamondNode(), {});
    // Figma's 1.0 stop sits at the points, which is half of the CSS gradient
    // line; the final colour then holds out to the tile's outer corner.
    expect(html).toContain("50%");
    expect(html).not.toContain("rgba(0, 0, 0, 1) 100%");
  });

  it("counts as exact rather than approximated", () => {
    const { fidelity } = mapFigmaNodeToHtml(diamondNode(), {});
    const entry = fidelity.entries.find((e) => e.nodeId === "1:1");
    expect(entry?.level).toBe("exact");
  });
});

describe("an empty auto-layout frame that hugs", () => {
  // Figma keeps a childless auto-layout frame at the size it resolved rather
  // than collapsing it — the Whitepace hero has a 685x456 image placeholder
  // exactly like this. Mapping HUG to `width: auto` collapsed it to nothing,
  // and its FILL sibling then took the whole row, so the heading also stopped
  // wrapping where Figma wraps it.
  function heroRow(): FigmaNode {
    return {
      id: "1:1",
      name: "Hero",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 1440, 656),
      layoutMode: "HORIZONTAL",
      layoutSizingHorizontal: "FIXED",
      children: [
        {
          id: "1:2",
          name: "Image-container",
          type: "FRAME",
          absoluteBoundingBox: box(700, 100, 685, 456),
          layoutMode: "VERTICAL",
          layoutSizingHorizontal: "HUG",
          layoutSizingVertical: "HUG",
        },
      ],
    } as FigmaNode;
  }

  it("keeps the size Figma resolved instead of collapsing to zero", () => {
    const { html } = mapFigmaNodeToHtml(heroRow(), {});
    expect(html).toContain("width: 685px");
    expect(html).toContain("height: 456px");
  });

  it("still hugs when there is content to hug", () => {
    const node = heroRow();
    node.children![0]!.children = [
      {
        id: "1:3",
        name: "Inner",
        type: "FRAME",
        absoluteBoundingBox: box(700, 100, 100, 50),
      } as FigmaNode,
    ];
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("width: auto");
    expect(html).not.toContain("width: 685px");
  });
});

describe("mirrored nodes", () => {
  // Figma's `rotation` is a decomposition, and it cannot tell a mirror from a
  // half turn: a horizontally flipped node reports rotation = pi, exactly as a
  // 180-degree one does. Rotating by 180 adds a vertical flip the design does
  // not have — Positivus' CTA illustration is mirrored this way, and every
  // element inside it landed on the wrong side of the group.
  function flippedGroup(): FigmaNode {
    return {
      id: "1:1",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 359, 394),
      children: [
        {
          id: "1:2",
          name: "Illustration",
          type: "GROUP",
          absoluteBoundingBox: box(0, 0, 359, 394),
          size: { x: 359, y: 394 },
          relativeTransform: [
            [-1, 0, 359],
            [0, 1, 0],
          ],
          rotation: Math.PI,
        },
      ],
    } as FigmaNode;
  }

  it("mirrors rather than rotating a flipped node", () => {
    const { html } = mapFigmaNodeToHtml(flippedGroup(), {});
    expect(html).toContain("matrix(-1, 0, 0, 1, 0, 0)");
    expect(html).not.toContain("rotate(180");
  });

  it("counts the matrix path as exact, not approximated", () => {
    const { fidelity } = mapFigmaNodeToHtml(flippedGroup(), {});
    const entry = fidelity.entries.find((e) => e.nodeId === "1:2");
    expect(entry?.level).toBe("exact");
  });

  it("still emits a plain rotate() when there is no relativeTransform", () => {
    const node = flippedGroup();
    delete node.children![0]!.relativeTransform;
    delete node.children![0]!.size;
    node.children![0]!.rotation = Math.PI / 4;
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("rotate(45");
  });
});
