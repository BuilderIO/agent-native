/**
 * Auto-layout rules Figma expresses directly and CSS does not. Each case pins a
 * shape that produced a plausible-looking but wrong layout, so a regression
 * shows up here rather than as a design that is subtly the wrong width.
 *
 * These live beside the source because `templates/design` imports core's built
 * `dist`; a spec there cannot see an unbuilt change to this file.
 */
import { describe, expect, it } from "vitest";

import {
  collectFallbackNodeIds,
  mapFigmaNodeToHtml,
  type FigmaNode,
} from "./figma-node-to-html.js";

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

describe("space-between rows ignore itemSpacing, as Figma does", () => {
  // Figma disables the spacing field under SPACE_BETWEEN and derives the gap
  // from the free space, but it still REPORTS whatever was last set. CSS
  // treats `gap` as a minimum that space-between distributes on top of, so
  // emitting both spaced Positivus' logo row by a stale 206px instead of its
  // real 96px and pushed the last logo 550px out of frame.
  function logoRow(align?: string): FigmaNode {
    return {
      id: "1:1",
      name: "Logotypes",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 1440, 48),
      layoutMode: "HORIZONTAL",
      layoutSizingHorizontal: "FIXED",
      itemSpacing: 206,
      primaryAxisAlignItems: align,
      children: [
        {
          id: "1:2",
          name: "A",
          type: "FRAME",
          absoluteBoundingBox: box(100, 0, 124, 48),
        },
        {
          id: "1:3",
          name: "B",
          type: "FRAME",
          absoluteBoundingBox: box(320, 0, 126, 48),
        },
      ],
    } as FigmaNode;
  }

  it("drops the stale gap under SPACE_BETWEEN", () => {
    const { html } = mapFigmaNodeToHtml(logoRow("SPACE_BETWEEN"), {});
    expect(html).toContain("justify-content: space-between");
    expect(html).not.toContain("column-gap: 206px");
  });

  it("keeps the gap under normal alignment", () => {
    const { html } = mapFigmaNodeToHtml(logoRow("MIN"), {});
    expect(html).toContain("column-gap: 206px");
  });
});

describe("negative itemSpacing is clamped so the children still fill the box", () => {
  // Figma clamps the overlap to whatever closes the container up: -715 between
  // a 1240px card and a 494px illustration in a 1240px content box draws at
  // -494, flush with the card's right edge. Taking the stated value literally
  // dragged Positivus' CTA illustration 221px across its card.
  function overlapRow(spacing: number, secondWidth: number): FigmaNode {
    return {
      id: "1:1",
      name: "CTA",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 1440, 394),
      layoutMode: "HORIZONTAL",
      layoutSizingHorizontal: "FIXED",
      paddingLeft: 100,
      paddingRight: 100,
      itemSpacing: spacing,
      children: [
        {
          id: "1:2",
          name: "Card",
          type: "FRAME",
          absoluteBoundingBox: box(100, 0, 1240, 347),
        },
        {
          id: "1:3",
          name: "Art",
          type: "FRAME",
          absoluteBoundingBox: box(846, 0, secondWidth, 394),
        },
      ],
    } as FigmaNode;
  }

  it("clamps an overlap that would overshoot the container", () => {
    const { html } = mapFigmaNodeToHtml(overlapRow(-715, 494), {});
    expect(html).toContain("margin-left: -494px");
    expect(html).not.toContain("margin-left: -715px");
  });

  // A FILL axis has a definite size just as much as a FIXED one — it takes its
  // parent's — so the clamp applies there too. Bailing on FILL left Positivus'
  // team-card social icon at the raw -67 where Figma draws -34, while the .fig
  // walker, whose payload calls the same node FIXED, already drew it right.
  it("clamps on a FILL axis, which is just as definite as FIXED", () => {
    const node = overlapRow(-67, 34);
    node.absoluteBoundingBox = box(0, 0, 517, 103);
    node.layoutSizingHorizontal = "FILL";
    node.children![0]!.absoluteBoundingBox = box(100, 0, 317, 103);
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("margin-left: -34px");
    expect(html).not.toContain("margin-left: -67px");
  });

  it("leaves the literal value on a HUG axis, which has nothing to fill", () => {
    const node = overlapRow(-67, 34);
    node.layoutSizingHorizontal = "HUG";
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("margin-left: -67px");
  });

  it("leaves an overlap that does not close the container up", () => {
    const { html } = mapFigmaNodeToHtml(overlapRow(-367, 692), {});
    expect(html).toContain("margin-left: -367px");
  });
});

describe("a rotated auto-layout child occupies its rotated footprint", () => {
  // A CSS transform does not change layout size, but Figma lays a rotated
  // child out by its rotated box. Figma stores a vertical rule as a 186x0 line
  // rotated 90deg: it takes no width in the row, while ours took the full
  // 186px and shoved every later sibling across.
  it("compensates a 90-degree turn with margins", () => {
    const node = {
      id: "1:1",
      name: "Row",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 1234, 326),
      layoutMode: "HORIZONTAL",
      children: [
        {
          id: "1:2",
          name: "Rule",
          type: "RECTANGLE",
          absoluteBoundingBox: box(410, 70, 20, 186),
          size: { x: 186, y: 20 },
          relativeTransform: [
            [0, -1, 430],
            [1, 0, 70],
          ],
          rotation: Math.PI / 2,
        },
      ],
    } as FigmaNode;
    const { html } = mapFigmaNodeToHtml(node, {});
    // 186x20 before the turn, 20x186 after: hand back 166px of row width and
    // claim the 166px of height the turn added.
    expect(html).toContain("margin-left: -83px");
    expect(html).toContain("margin-top: 83px");
  });

  it("leaves an unrotated child's footprint alone", () => {
    const node = {
      id: "1:1",
      name: "Row",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 1234, 326),
      layoutMode: "HORIZONTAL",
      children: [
        {
          id: "1:2",
          name: "Plain",
          type: "RECTANGLE",
          absoluteBoundingBox: box(0, 0, 186, 20),
          size: { x: 186, y: 20 },
          relativeTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
        },
      ],
    } as FigmaNode;
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("margin-top");
  });
});

describe("a HUG container holding a cross-axis FILL child", () => {
  // A FILL child does not feed Figma's hug: Figma sizes the container from its
  // other children, then stretches the FILL child to that. CSS has no such
  // rule — `align-self: stretch` with `width: auto` still feeds the child's
  // max-content into the container's shrink-to-fit width. A Positivus team
  // card holds a FILL row with 76px of right padding, so the column hugged
  // 393px where Figma hugs 317 and every sibling moved with it.
  function card(): FigmaNode {
    return {
      id: "1:1",
      name: "Card",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 387, 331),
      layoutMode: "VERTICAL",
      layoutSizingHorizontal: "FIXED",
      paddingLeft: 35,
      paddingRight: 35,
      children: [
        {
          id: "1:2",
          name: "Content",
          type: "FRAME",
          absoluteBoundingBox: box(35, 0, 317, 251),
          layoutMode: "VERTICAL",
          layoutSizingHorizontal: "HUG",
          children: [
            {
              id: "1:3",
              name: "Person",
              type: "FRAME",
              absoluteBoundingBox: box(35, 0, 317, 103),
              layoutMode: "HORIZONTAL",
              layoutSizingHorizontal: "FILL",
              paddingRight: 76,
            },
          ],
        },
      ],
    } as FigmaNode;
  }

  it("uses the width Figma resolved rather than hugging max-content", () => {
    const { html } = mapFigmaNodeToHtml(card(), {});
    expect(html).toContain("width: 317px");
  });

  it("still hugs when no child fills the cross axis", () => {
    const node = card();
    node.children![0]!.children![0]!.layoutSizingHorizontal = "FIXED";
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("width: auto");
  });
});

describe("zero-thickness lines", () => {
  // A LINE has no thickness by definition. Requiring both dimensions to be
  // positive pushed every rotated rule onto the absoluteBoundingBox fallback,
  // whose box is the ALREADY-ROTATED one — rotating that again squared the
  // turn and drew a 216x205 diagonal where Figma draws 126x176.
  it("places a rotated rule from its own size, not the rotated bounding box", () => {
    const node = {
      id: "1:1",
      name: "Element",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: "1:2",
          name: "Line 4",
          type: "LINE",
          absoluteBoundingBox: box(160, 72, 126, 176),
          size: { x: 216, y: 0 },
          relativeTransform: [
            [0.5828, -0.8126, 160],
            [0.8126, 0.5828, 72],
          ],
          rotation: 0.948,
          strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokeWeight: 3,
          strokeGeometry: [{ path: "M0 0L216 0", windingRule: "NONZERO" }],
        },
      ],
    } as FigmaNode;
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("width: 216px");
    expect(html).not.toContain("width: 126px");
  });
});

describe("a FILL child may shrink below its content", () => {
  // `min-width` defaults to `auto` on a flex item, which refuses to shrink
  // past the content. Figma's FILL just takes the parent's width and lets the
  // content overflow.
  it("emits min-width: 0 alongside flex-grow", () => {
    const node = {
      id: "1:1",
      name: "Row",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 317, 103),
      layoutMode: "HORIZONTAL",
      children: [
        {
          id: "1:2",
          name: "Wide",
          type: "FRAME",
          absoluteBoundingBox: box(0, 0, 317, 103),
          layoutSizingHorizontal: "FILL",
        },
      ],
    } as FigmaNode;
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("flex-grow: 1");
    expect(html).toContain("min-width: 0");
  });
});

describe("underline placement", () => {
  it("puts an underline where Figma puts it, below the descender", () => {
    // Measured on the typography fixture: Figma draws the rule at row 336
    // against the browser default's 332 at an 18px font. `under` is the
    // keyword for "below the descender", which is where Figma draws it.
    const { html } = mapFigmaNodeToHtml(
      {
        id: "1:1",
        name: "Link",
        type: "TEXT",
        absoluteBoundingBox: box(0, 0, 200, 24),
        characters: "Underlined inline link text",
        style: {
          fontFamily: "Inter",
          fontSize: 18,
          lineHeightPx: 23,
          textDecoration: "UNDERLINE",
        },
      } as FigmaNode,
      {},
    );
    expect(html).toContain("text-decoration: underline");
    expect(html).toContain("text-underline-position: under");
  });

  it("leaves undecorated text alone", () => {
    const { html } = mapFigmaNodeToHtml(
      {
        id: "1:1",
        name: "Label",
        type: "TEXT",
        absoluteBoundingBox: box(0, 0, 200, 24),
        characters: "Plain",
        style: { fontFamily: "Inter", fontSize: 18, lineHeightPx: 23 },
      } as FigmaNode,
      {},
    );
    expect(html).not.toContain("text-underline-position");
  });
});

describe("which break characters Figma actually lays out", () => {
  // `characters` can carry breaks Figma does not draw as breaks: a real footer
  // stores "Get started for free.\rAdd your whole team…" and renders it as one
  // flowing paragraph. `lineTypes` has one entry per line Figma laid out, so it
  // says how many are real — measured across the corpus it is never wrong,
  // while trusting each break character overstates the count on 8 of 20 nodes.
  function label(characters: string, lineTypes?: string[]): FigmaNode {
    return {
      id: "1:1",
      name: "Point",
      type: "TEXT",
      absoluteBoundingBox: box(0, 0, 312, 40),
      characters,
      lineTypes,
      style: { fontFamily: "Inter", fontSize: 16, lineHeightPx: 20 },
    } as FigmaNode;
  }

  it("keeps a break Figma counted as a line", () => {
    const { html } = mapFigmaNodeToHtml(
      label("First\rSecond", ["NONE", "NONE"]),
      {},
    );
    expect(html).toMatch(/First[\r\n]Second/);
  });

  it("draws a break Figma did NOT count as the space it renders", () => {
    const { html } = mapFigmaNodeToHtml(
      label("Get started for free.\rAdd your whole team.", ["NONE"]),
      {},
    );
    expect(html).toContain("Get started for free. Add your whole team.");
  });

  it("drops a trailing break Figma did not count", () => {
    const { html } = mapFigmaNodeToHtml(
      label("Connect the account\r", ["NONE"]),
      {},
    );
    expect(html).toContain("Connect the account");
    expect(html).not.toMatch(/Connect the account[\r\n ]/);
  });

  it("drops trailing spaces that follow the break, which Figma also ignores", () => {
    const { html } = mapFigmaNodeToHtml(
      label("Add due dates\r ", ["NONE"]),
      {},
    );
    expect(html).not.toMatch(/Add due dates[\r\n ]/);
  });

  it("treats CRLF as one break, not two", () => {
    const { html } = mapFigmaNodeToHtml(
      label("First\r\nSecond", ["NONE", "NONE"]),
      {},
    );
    expect(html).toMatch(/First[\r\n]+Second/);
    expect(html).not.toContain("First\r\n\r\nSecond");
  });

  it("keeps as many breaks as Figma counted and folds only the extras", () => {
    const { html } = mapFigmaNodeToHtml(label("a\rb\rc", ["NONE", "NONE"]), {});
    expect(html).toMatch(/a[\r\n]b c/);
  });

  it("drops a trailing space, which Figma neither draws nor hugs to", () => {
    // Of 943 hugging text nodes measured, the only ones wider than Figma's own
    // box were the 3 ending in a space — "Our Working Process " hugged 9px wide
    // and pushed its whole row across.
    const { html } = mapFigmaNodeToHtml(
      label("Our Working Process ", ["NONE"]),
      {},
    );
    expect(html).toContain(">Our Working Process<");
  });

  it("keeps a trailing break Figma counted as its own empty line", () => {
    const { html } = mapFigmaNodeToHtml(
      label("Heading\r", ["NONE", "NONE"]),
      {},
    );
    expect(html).toMatch(/Heading[\r\n]/);
  });

  it("still drops a trailing break when Figma reports no line count", () => {
    // Absent `lineTypes` leaves no authority to check against, but a trailing
    // break is settleable regardless: Figma never draws one, pre-wrap always does.
    const { html } = mapFigmaNodeToHtml(label("Connect the account\r"), {});
    expect(html).not.toMatch(/Connect the account[\r\n]/);
  });

  it("leaves interior breaks alone when Figma reports no line count", () => {
    const { html } = mapFigmaNodeToHtml(label("First\rSecond"), {});
    expect(html).toMatch(/First[\r\n]Second/);
  });
});

describe("Figma rounds a hugging text box's height", () => {
  // `round(lines * lineHeight)` — and it rounds DOWN as often as up, so a
  // minimum cannot reach it. Two Space Grotesk headings at 38.28px line height
  // hugged to 38.28 each where Figma laid out 38, and the 0.56px pushed their
  // whole column down 2px.
  function headingInStack(autoResize: string): FigmaNode {
    return {
      id: "1:1",
      name: "Heading",
      type: "FRAME",
      layoutMode: "VERTICAL",
      layoutSizingHorizontal: "HUG",
      layoutSizingVertical: "HUG",
      absoluteBoundingBox: box(0, 0, 119, 38),
      children: [
        {
          id: "1:2",
          name: "Label",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 119, 38),
          layoutSizingHorizontal: "HUG",
          layoutSizingVertical: "HUG",
          characters: "Content",
          style: {
            fontFamily: "Space Grotesk",
            fontSize: 30,
            lineHeightPx: 38.279998779296875,
            textAutoResize: autoResize,
          },
        },
      ],
    } as unknown as FigmaNode;
  }

  it("pins the height when the text hugs both axes and so cannot wrap", () => {
    const { html } = mapFigmaNodeToHtml(headingInStack("WIDTH_AND_HEIGHT"), {});
    expect(html).toMatch(/(?<!min-)height: 38px/);
    expect(html).not.toContain("height: auto");
  });

  it("keeps it a minimum when the text can wrap, where our line count may differ", () => {
    const { html } = mapFigmaNodeToHtml(headingInStack("HEIGHT"), {});
    expect(html).toContain("min-height: 38px");
    expect(html).toContain("height: auto");
  });
});

describe("an INSIDE stroke stays inside its shape", () => {
  // `strokeGeometry` is the stroke already outlined into a region, but that
  // outline is NOT clipped to the alignment Figma states — and a mitred corner
  // reaches a long way. The parity fixture's star has a 5px inside stroke whose
  // outline runs 16px past its top point: it drew a band three times too thick
  // over a silhouette bigger than Figma's own ink (114x109 in a 120x120 box).
  function star(strokeAlign: string): FigmaNode {
    return {
      id: "5:6",
      name: "Multi Stroke Star",
      type: "STAR",
      absoluteBoundingBox: box(0, 0, 120, 120),
      strokeWeight: 5,
      strokeAlign,
      fills: [{ type: "SOLID", color: { r: 0.4, g: 0.25, b: 0.9, a: 1 } }],
      strokes: [{ type: "SOLID", color: { r: 0.25, g: 0.85, b: 1, a: 1 } }],
      fillGeometry: [{ path: "M60 0L117 41L82 67L60 109L38 67L3 41Z" }],
      strokeGeometry: [{ path: "M60 0L64.7 -1.5L60 -16.2L55.2 -1.5Z" }],
    } as unknown as FigmaNode;
  }

  it("clips the outlined stroke to the fill shape", () => {
    const { html } = mapFigmaNodeToHtml(star("INSIDE"), {});
    expect(html).toContain("<clipPath");
    expect(html).toMatch(/<g clip-path="url\(#stroke-inside-5-6\)">/);
  });

  it("leaves a CENTER stroke unclipped, which is what CENTER means", () => {
    const { html } = mapFigmaNodeToHtml(star("CENTER"), {});
    expect(html).not.toContain("stroke-inside");
  });
});

describe("text Figma laid out on one line must not wrap", () => {
  // Our advances run a hair wider than Figma's on some strings, and a second
  // line pushes every sibling down and reads as broken where a few pixels of
  // overflow does not. DashStack's placeholder is 193px of Nunito Sans
  // SemiBold, emitted at Figma's own width because it sits outside auto-layout.
  function placeholder(height: number, lineTypes: string[]): FigmaNode {
    return {
      id: "1:1",
      name: "Placeholder",
      type: "TEXT",
      absoluteBoundingBox: box(0, 0, 193, height),
      characters: "Write Your task name here",
      lineTypes,
      style: {
        fontFamily: "Nunito Sans",
        fontSize: 16,
        lineHeightPx: 27,
        textAutoResize: "WIDTH_AND_HEIGHT",
      },
    } as FigmaNode;
  }

  it("refuses the break Figma did not take", () => {
    const { html } = mapFigmaNodeToHtml(placeholder(27, ["NONE"]), {});
    expect(html).toContain("white-space: pre");
    expect(html).not.toContain("white-space: pre-wrap");
  });

  it("still lets genuinely multi-line text wrap", () => {
    const { html } = mapFigmaNodeToHtml(placeholder(54, ["NONE"]), {});
    expect(html).toContain("white-space: pre-wrap");
  });
});

describe("an image fallback must not be distorted", () => {
  // `/images` does not always return a PNG whose aspect matches the
  // `absoluteRenderBounds` it reports: a masked group came back 1210x594 for a
  // 605x348 box, and 9 of the 28 fallbacks on one product page were being
  // stretched to fit — four of them by more than 30%.
  function masked(): FigmaNode {
    return {
      id: "1:1",
      name: "Mask group",
      type: "GROUP",
      absoluteBoundingBox: box(0, 0, 605, 348),
      absoluteRenderBounds: box(0, 0, 605, 348),
      children: [
        {
          id: "1:2",
          name: "Mask",
          type: "RECTANGLE",
          isMask: true,
        } as FigmaNode,
      ],
    } as FigmaNode;
  }

  it("keeps the render's own aspect instead of stretching it to the box", () => {
    const { html } = mapFigmaNodeToHtml(masked(), {
      fallbackImageUrls: { "1:1": "https://example.invalid/group.png" },
    });
    expect(html).toContain("object-fit: contain");
  });

  it("anchors it where the ink starts, not centred in the leftover space", () => {
    // `absoluteRenderBounds` states where the ink STARTS; centring splits the
    // leftover space around the artwork and moves it.
    const { html } = mapFigmaNodeToHtml(masked(), {
      fallbackImageUrls: { "1:1": "https://example.invalid/group.png" },
    });
    expect(html).toContain("object-position: 0 0");
  });
});

describe("an image fallback's ink must not take layout space", () => {
  // Figma stacks siblings against the GEOMETRIC box and paints ink outside it.
  // The fallback <img> is sized from render bounds so the artwork is not
  // squished, so in flow it consumed the overflow as real layout: a horizontal
  // LINE is zero-height and entirely overflow, and every rule on a page pushed
  // everything below it down a pixel.
  function ruleInStack(): FigmaNode {
    return {
      id: "1:1",
      name: "Card",
      type: "FRAME",
      layoutMode: "VERTICAL",
      absoluteBoundingBox: box(0, 0, 317, 100),
      children: [
        {
          id: "1:2",
          name: "Line 3",
          type: "LINE",
          absoluteBoundingBox: box(0, 40, 317, 0),
          absoluteRenderBounds: box(0, 39.5, 317, 1),
          strokeWeight: 1,
        },
      ],
    } as FigmaNode;
  }

  it("cancels the overflow with negative margins so the footprint is the box", () => {
    const { html } = mapFigmaNodeToHtml(ruleInStack(), {
      fallbackImageUrls: { "1:2": "https://example.invalid/line.png" },
    });
    // Drawn at its real 1px, but -0.5px top and bottom leave a 0px footprint.
    expect(html).toContain("height: 1px");
    expect(html).toContain("margin-top: -0.5px");
    expect(html).toContain("margin-bottom: -0.5px");
  });

  it("leaves an image whose ink matches its box unmargined", () => {
    const node = ruleInStack();
    node.children![0]!.absoluteRenderBounds = box(0, 40, 317, 0);
    const { html } = mapFigmaNodeToHtml(node, {
      fallbackImageUrls: { "1:2": "https://example.invalid/line.png" },
    });
    expect(html).not.toContain("margin-top");
    expect(html).not.toContain("margin-bottom");
  });
});

describe("angular (conic) gradients sweep in Figma's normalized space", () => {
  // Figma treats the box as a unit square and stretches the result; CSS
  // conic-gradient() sweeps at a true uniform angular rate in real pixels. The
  // two agree only on the axes, so on a 180x85 tile the mid-sweep stops landed
  // visibly early — 5.4 points of the fills/effects fixture.
  function angularTile(width: number, height: number): FigmaNode {
    return {
      id: "1:1",
      name: "Angular",
      type: "RECTANGLE",
      absoluteBoundingBox: box(0, 0, width, height),
      fills: [
        {
          type: "GRADIENT_ANGULAR",
          gradientHandlePositions: [
            { x: 0.5, y: 0.5 },
            { x: 1, y: 0.5 },
            { x: 0.5, y: 1 },
          ],
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 1, a: 1 } },
            { position: 1, color: { r: 0, g: 1, b: 0.5, a: 1 } },
          ],
        },
      ],
    } as FigmaNode;
  }

  it("draws into a square and scales it to the box", () => {
    const { html } = mapFigmaNodeToHtml(angularTile(180, 85), {});
    expect(html).toContain("conic-gradient");
    // Square of the box's width, squashed to its height.
    expect(html).toContain("width: 180px");
    expect(html).toContain("height: 180px");
    expect(html).toContain("scale(1, 0.472222)");
  });

  it("needs no squash on a square box", () => {
    const { html } = mapFigmaNodeToHtml(angularTile(120, 120), {});
    expect(html).toContain("scale(1, 1)");
  });

  it("counts as exact rather than approximated", () => {
    const { fidelity } = mapFigmaNodeToHtml(angularTile(180, 85), {});
    expect(fidelity.entries.find((e) => e.nodeId === "1:1")?.level).toBe(
      "exact",
    );
  });
});

describe("zero-thickness vector geometry", () => {
  // The SVG spec says a viewBox with a zero width or height DISABLES rendering
  // of the element, so a stroked path whose own box is 20x0 — a rule, or the
  // arrow inside a "Learn more" button — vanished with no warning.
  function arrow(width: number, height: number): FigmaNode {
    return {
      id: "1:1",
      name: "Icon",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 41, 41),
      children: [
        {
          id: "1:2",
          name: "Arrow 1",
          type: "VECTOR",
          absoluteBoundingBox: box(10, 21, 17, 10),
          size: { x: width, y: height },
          relativeTransform: [
            [1, 0, 10],
            [0, 1, 21],
          ],
          strokeWeight: 3,
          strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokeGeometry: [{ path: "M0 0L20 0", windingRule: "NONZERO" }],
        },
      ],
    } as FigmaNode;
  }

  it("gives a collapsed axis the stroke's width so the shape still renders", () => {
    const { html } = mapFigmaNodeToHtml(arrow(20, 0), {});
    expect(html).toContain('viewBox="0 -1.5 20 3"');
    expect(html).not.toContain('viewBox="0 0 20 0"');
  });

  it("sizes and offsets the svg in real pixels, since 100% of zero is zero", () => {
    const { html } = mapFigmaNodeToHtml(arrow(20, 0), {});
    expect(html).toContain('width="20" height="3"');
    expect(html).toContain("top: -1.5px");
  });

  it("leaves an ordinary vector on percentage sizing", () => {
    const { html } = mapFigmaNodeToHtml(arrow(20, 10), {});
    expect(html).toContain('width="100%" height="100%"');
    expect(html).toContain('viewBox="0 0 20 10"');
  });
});

describe("Figma's image crop (STRETCH with an imageTransform)", () => {
  // STRETCH plus an imageTransform is Figma's Crop mode: the matrix picks a
  // sub-rectangle of the image — origin (tx, ty), size (a, d) in the image's
  // own normalized space — and stretches THAT to fill the box. Ignoring it
  // draws the whole image instead, which reads as the artwork zoomed out.
  // Every illustration on the Positivus services cards came out visibly
  // smaller than Figma draws it.
  function cropped(transform?: number[][]): FigmaNode {
    return {
      id: "1:1",
      name: "Illustration",
      type: "RECTANGLE",
      absoluteBoundingBox: box(0, 0, 200, 100),
      fills: [
        {
          type: "IMAGE",
          scaleMode: "STRETCH",
          imageRef: "abc",
          ...(transform ? { imageTransform: transform } : {}),
        },
      ],
    } as FigmaNode;
  }
  const urls = { imageFillUrls: { abc: "https://example.test/i.png" } };

  it("zooms the box onto the cropped sub-rectangle", () => {
    // Half the image's width and a quarter of its height, offset a tenth in.
    const { html } = mapFigmaNodeToHtml(
      cropped([
        [0.5, 0, 0.1],
        [0, 0.25, 0.2],
      ]),
      urls,
    );
    // 200 / 0.5 = 400 wide, 100 / 0.25 = 400 tall.
    expect(html).toContain("background-size: 400px 400px");
    // Origin pulled back by the crop offset in displayed pixels.
    expect(html).toContain("background-position: -40px -80px");
  });

  it("stays a plain stretch when there is no transform", () => {
    const { html } = mapFigmaNodeToHtml(cropped(), urls);
    expect(html).toContain("background-size: 100% 100%");
  });

  // A rotated or skewed crop has no background-position equivalent at all, so
  // it takes the raster fallback rather than being flattened to a stretch —
  // a rendered PNG of the node is exact where a stretch would be wrong.
  it("sends a rotated crop to the raster fallback instead of stretching it", () => {
    const node = cropped([
      [0.5, 0.3, 0.1],
      [0.3, 0.25, 0.2],
    ]);
    const { html } = mapFigmaNodeToHtml(node, {
      ...urls,
      fallbackImageUrls: { "1:1": "https://example.test/rendered.png" },
    });
    expect(html).toContain("<img");
    expect(html).toContain("rendered.png");
    expect(html).not.toContain("background-size");
  });
});

describe("a hugging text box takes Figma's rounded width as a minimum", () => {
  // Figma rounds a hugging TEXT box to a whole pixel — every one of the 2619
  // in the corpus is an integer — and lays its siblings out against that
  // rounded width. Hugging to our own fractional width makes each label a
  // fraction narrower, and in a row of them the fractions add up: a nav came
  // out 5px short across six items.
  function label(): FigmaNode {
    return {
      id: "1:1",
      name: "Row",
      type: "FRAME",
      absoluteBoundingBox: box(0, 0, 400, 40),
      layoutMode: "HORIZONTAL",
      children: [
        {
          id: "1:2",
          name: "Nav item",
          type: "TEXT",
          absoluteBoundingBox: box(0, 0, 70, 40),
          layoutSizingHorizontal: "HUG",
          characters: "Pricing",
          style: { fontFamily: "Inter", fontSize: 16, lineHeightPx: 20 },
        },
      ],
    } as FigmaNode;
  }

  it("sets it as a minimum, so the box is never narrower than Figma's", () => {
    const { html } = mapFigmaNodeToHtml(label(), {});
    expect(html).toContain("min-width: 70px");
  });

  // Pinning `width` outright forces a wrap wherever our advances run a hair
  // wider than Figma's, which is a different layout entirely — it scored 36%
  // on the parity fixture and 19% on a pricing page.
  it("does not pin the width, which would force the text to wrap", () => {
    const { html } = mapFigmaNodeToHtml(label(), {});
    expect(html).toContain("width: auto");
    // `min-width: 70px` contains that substring, so match the property itself.
    expect(html).not.toMatch(/(?<!min-)width: 70px/);
  });

  it("leaves an explicit minWidth from Figma alone", () => {
    const node = label();
    node.children![0]!.minWidth = 120;
    const { html } = mapFigmaNodeToHtml(node, {});
    expect(html).toContain("min-width: 120px");
    expect(html).not.toMatch(/min-width: 70px/);
  });
});

describe("icon-font glyphs", () => {
  // DashStack's sidebar labels each carry a LineAwesome glyph at U+F2C6. No
  // Google font serves that codepoint, so Chromium drew a .notdef box beside
  // every nav item where Figma draws an icon.
  function iconLabel(characters: string): FigmaNode {
    return {
      id: "1:1",
      name: "Icon",
      type: "TEXT",
      absoluteBoundingBox: box(0, 0, 22, 25),
      characters,
      style: { fontFamily: "LineAwesome", fontSize: 20 },
    } as FigmaNode;
  }

  it("renders a Private Use Area glyph from Figma instead of a .notdef box", () => {
    expect(collectFallbackNodeIds(iconLabel("\uf2c6"), {})).toEqual(["1:1"]);
  });

  it("leaves ordinary text alone", () => {
    expect(collectFallbackNodeIds(iconLabel("Dashboard"), {})).toEqual([]);
  });
});
