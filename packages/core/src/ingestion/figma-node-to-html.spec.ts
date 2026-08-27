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
