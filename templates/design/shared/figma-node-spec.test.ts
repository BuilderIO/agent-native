import { describe, expect, it } from "vitest";

import { buildFigmaNodeSpec } from "./figma-node-spec.js";
import type { FigmaSvgLayoutFacts, FigmaSvgNode } from "./figma-svg-scene.js";

function facts(
  overrides: Partial<FigmaSvgLayoutFacts> = {},
): FigmaSvgLayoutFacts {
  return {
    display: "block",
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "normal",
    alignItems: "normal",
    rowGapPx: 0,
    columnGapPx: 0,
    paddingPx: [0, 0, 0, 0],
    position: "static",
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    alignSelf: "auto",
    ...overrides,
  };
}

function box(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
  overrides: Partial<FigmaSvgNode> = {},
): FigmaSvgNode {
  return {
    id,
    name: id,
    kind: "box",
    rect,
    layout: facts(),
    children: [],
    ...overrides,
  };
}

/** A 256x100 row: two 100x100 children, 16px gap, 20px horizontal padding. */
function flexRow(overrides: Partial<FigmaSvgLayoutFacts> = {}): FigmaSvgNode {
  return box(
    "row",
    { x: 0, y: 0, width: 256, height: 100 },
    {
      layout: facts({
        display: "flex",
        flexDirection: "row",
        columnGapPx: 16,
        paddingPx: [0, 20, 0, 20],
        ...overrides,
      }),
      fills: [{ kind: "solid", color: "rgb(255, 255, 255)" }],
      children: [
        box("a", { x: 20, y: 0, width: 100, height: 100 }),
        box("b", { x: 136, y: 0, width: 100, height: 100 }),
      ],
    },
  );
}

describe("buildFigmaNodeSpec — layout mapping", () => {
  it("maps a flex row to HORIZONTAL auto-layout with gap and padding", () => {
    const { root, report } = buildFigmaNodeSpec(flexRow());
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.layout.itemSpacing).toBe(16);
    expect(root.layout.paddingLeft).toBe(20);
    expect(root.layout.paddingRight).toBe(20);
    expect(root.layout.primaryAxisAlignItems).toBe("MIN");
    expect(report.autoLayoutFrames).toBe(1);
    expect(report.absoluteFrames).toBe(0);
  });

  it("maps a flex column to VERTICAL and reads the row gap", () => {
    const scene = box(
      "col",
      { x: 0, y: 0, width: 100, height: 216 },
      {
        layout: facts({
          display: "flex",
          flexDirection: "column",
          rowGapPx: 16,
        }),
        fills: [{ kind: "solid", color: "rgb(1, 2, 3)" }],
        children: [
          box("a", { x: 0, y: 0, width: 100, height: 100 }),
          box("b", { x: 0, y: 116, width: 100, height: 100 }),
        ],
      },
    );
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("VERTICAL");
    expect(root.layout.itemSpacing).toBe(16);
  });

  it("maps justify-content: center to CENTER", () => {
    const scene = flexRow({ justifyContent: "center" });
    scene.rect.width = 336; // 40px of free space on each side
    scene.children![0].rect.x = 60;
    scene.children![1].rect.x = 176;
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.layout.primaryAxisAlignItems).toBe("CENTER");
  });

  it("maps justify-content: space-between to SPACE_BETWEEN", () => {
    const scene = flexRow({ justifyContent: "space-between" });
    scene.rect.width = 400;
    scene.children![0].rect.x = 20;
    scene.children![1].rect.x = 280;
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
  });

  it("reports justify-content: space-evenly as unrepresentable", () => {
    const scene = flexRow({ justifyContent: "space-evenly" });
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("NONE");
    expect(report.notes.some((n) => n.note.includes("space-evenly"))).toBe(
      true,
    );
  });

  it("folds the CSS border width into Figma's padding", () => {
    const scene = flexRow();
    scene.border = { widthPx: 1, color: "rgb(226, 232, 240)" };
    scene.rect.width = 258;
    scene.rect.height = 102;
    scene.children![0].rect.x = 21;
    scene.children![0].rect.y = 1;
    scene.children![1].rect.x = 137;
    scene.children![1].rect.y = 1;
    const { root } = buildFigmaNodeSpec(scene);
    // A Figma stroke does not inset auto-layout children the way a CSS
    // border does, so the border has to arrive as padding or every child
    // lands 1px high and left.
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.layout.paddingLeft).toBe(21);
    expect(root.layout.paddingTop).toBe(1);
  });

  it("treats space-between with a single flow child as MIN", () => {
    const scene = flexRow({ justifyContent: "space-between" });
    scene.children!.pop();
    scene.rect.width = 140;
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.layout.primaryAxisAlignItems).toBe("MIN");
  });

  it("maps align-items: center to CENTER on the counter axis", () => {
    const scene = flexRow({ alignItems: "center" });
    scene.rect.height = 200;
    scene.children![0].rect.y = 50;
    scene.children![1].rect.y = 50;
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.counterAxisAlignItems).toBe("CENTER");
  });

  it("stretches a child that already fills the counter axis", () => {
    const scene = flexRow({ alignItems: "stretch" });
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.children[0].layoutAlign).toBe("STRETCH");
    expect(root.children[0].layoutSizingVertical).toBe("FILL");
  });

  it("does not stretch a child whose measured height is smaller", () => {
    const scene = flexRow({ alignItems: "stretch" });
    scene.children![0].rect.height = 40;
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.counterAxisAlignItems).toBe("MIN");
    expect(root.children[0].layoutAlign).toBeUndefined();
    expect(root.children[0].layoutSizingVertical).toBe("FIXED");
  });

  it("maps flex-grow to layoutGrow when Figma's even split reproduces the size", () => {
    const scene = flexRow();
    scene.children![0].layout = facts({ flexGrow: 1 });
    scene.children![1].layout = facts({ flexGrow: 1 });
    const { root } = buildFigmaNodeSpec(scene);
    // 256 - 40 padding - 16 gap = 200, split evenly = the measured 100 each.
    expect(root.children[0].layoutGrow).toBe(1);
    expect(root.children[0].layoutSizingHorizontal).toBe("FILL");
  });

  it("refuses layoutGrow for uneven flex-grow ratios and reports why", () => {
    const scene = box(
      "row",
      { x: 0, y: 0, width: 316, height: 100 },
      {
        layout: facts({
          display: "flex",
          flexDirection: "row",
          columnGapPx: 16,
        }),
        fills: [{ kind: "solid", color: "rgb(9, 9, 9)" }],
        children: [
          box(
            "wide",
            { x: 0, y: 0, width: 200, height: 100 },
            {
              layout: facts({ flexGrow: 2 }),
            },
          ),
          box(
            "narrow",
            { x: 216, y: 0, width: 100, height: 100 },
            {
              layout: facts({ flexGrow: 1 }),
            },
          ),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.children[0].layoutGrow).toBeUndefined();
    expect(root.children[0].layoutSizingHorizontal).toBe("FIXED");
    expect(report.notes.some((n) => n.note.includes("flex-grow ratios"))).toBe(
      true,
    );
  });

  it("marks an absolutely positioned flex child as ABSOLUTE and skips it in the flow", () => {
    const scene = flexRow();
    scene.children!.push(
      box(
        "badge",
        { x: 300, y: -10, width: 20, height: 20 },
        {
          layout: facts({ position: "absolute" }),
        },
      ),
    );
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.children[2].layoutPositioning).toBe("ABSOLUTE");
    expect(root.children[0].layoutPositioning).toBeUndefined();
  });

  it("maps flex-wrap to layoutWrap with the row gap as counterAxisSpacing", () => {
    const scene = box(
      "wrap",
      { x: 0, y: 0, width: 216, height: 216 },
      {
        layout: facts({
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          columnGapPx: 16,
          rowGapPx: 16,
        }),
        fills: [{ kind: "solid", color: "rgb(4, 4, 4)" }],
        children: [
          box("a", { x: 0, y: 0, width: 100, height: 100 }),
          box("b", { x: 116, y: 0, width: 100, height: 100 }),
          box("c", { x: 0, y: 116, width: 100, height: 100 }),
          box("d", { x: 116, y: 116, width: 100, height: 100 }),
        ],
      },
    );
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.layout.layoutWrap).toBe("WRAP");
    expect(root.layout.counterAxisSpacing).toBe(16);
  });

  it("maps a single-row CSS grid to a horizontal stack", () => {
    const scene = flexRow({ display: "grid" });
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
  });

  it("gives equal grid tracks FILL even though grid items have flex-grow: 0", () => {
    const scene = flexRow({ display: "grid" });
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.children[0].layoutSizingHorizontal).toBe("FILL");
    expect(root.children[1].layoutGrow).toBe(1);
    expect(report.notes).toEqual([]);
  });

  it("leaves uneven grid tracks FIXED without inventing a warning", () => {
    const scene = flexRow({ display: "grid" });
    scene.rect.width = 356;
    scene.children![1].rect.width = 200;
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(root.children[0].layoutSizingHorizontal).toBe("FIXED");
    expect(report.notes).toEqual([]);
  });

  it("reports a two-axis CSS grid instead of pretending", () => {
    const scene = box(
      "grid",
      { x: 0, y: 0, width: 216, height: 216 },
      {
        layout: facts({ display: "grid", columnGapPx: 16, rowGapPx: 16 }),
        fills: [{ kind: "solid", color: "rgb(4, 4, 4)" }],
        children: [
          box("a", { x: 0, y: 0, width: 100, height: 100 }),
          box("b", { x: 116, y: 0, width: 100, height: 100 }),
          box("c", { x: 0, y: 116, width: 100, height: 100 }),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("NONE");
    expect(report.notes.some((n) => n.note.includes("single-axis"))).toBe(true);
    expect(report.absoluteFrames).toBe(1);
  });

  it("falls back to absolute when auto-layout would move a child (CSS margin)", () => {
    const scene = flexRow();
    // A 12px margin-left on the second child is real CSS with no Figma
    // equivalent — auto-layout would slide it back by 12px.
    scene.children![1].rect.x = 148;
    scene.rect.width = 248;
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("NONE");
    expect(
      report.notes.some((n) => n.note.includes("would move a child")),
    ).toBe(true);
  });

  it("hugs only when hugging reproduces the measured box", () => {
    const hugging = buildFigmaNodeSpec(flexRow({ alignItems: "center" }));
    expect(hugging.root.layout.primaryAxisSizingMode).toBe("AUTO");
    expect(hugging.root.layout.counterAxisSizingMode).toBe("AUTO");

    const oversized = flexRow({ justifyContent: "flex-start" });
    oversized.rect.width = 400; // 164px of slack the children do not fill
    oversized.rect.height = 160;
    const fixed = buildFigmaNodeSpec(oversized);
    expect(fixed.root.layout.primaryAxisSizingMode).toBe("FIXED");
    expect(fixed.root.layout.counterAxisSizingMode).toBe("FIXED");
  });

  it("keeps padded text as a padded auto-layout frame wrapping a TEXT node", () => {
    const scene = box(
      "cta",
      { x: 0, y: 0, width: 120, height: 40 },
      {
        kind: "text",
        layout: facts({ paddingPx: [8, 14, 8, 14] }),
        fills: [{ kind: "solid", color: "rgb(15, 23, 42)" }],
        text: {
          lines: [{ text: "New run", x: 14, y: 26 }],
          style: {
            fontFamily: "Inter",
            fontSizePx: 13,
            color: "rgb(255, 255, 255)",
          },
        },
      },
    );
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.type).toBe("FRAME");
    expect(root.layout.paddingLeft).toBe(14);
    expect(root.layout.paddingTop).toBe(8);
    expect(root.children[0].type).toBe("TEXT");
    expect(root.children[0].width).toBe(92);
    expect(root.children[0].height).toBe(24);
    expect(root.children[0].text?.lines).toEqual(["New run"]);
  });

  it("carries the browser-resolved font family, not just the CSS fallback list", () => {
    const scene = box(
      "label",
      { x: 0, y: 0, width: 80, height: 20 },
      {
        kind: "text",
        text: {
          lines: [{ text: "Overview", x: 0, y: 14 }],
          style: {
            fontFamily: "Inter, Helvetica, Arial, sans-serif",
            resolvedFontFamily: "Helvetica",
            fontSizePx: 13,
            color: "rgb(0, 0, 0)",
          },
        },
      },
    );
    const { root } = buildFigmaNodeSpec(scene);
    // Every width in this spec is Helvetica's width; materializing in Inter
    // silently changes them, so the family that was measured has to travel
    // with the geometry.
    expect(root.text?.resolvedFontFamily).toBe("Helvetica");
    expect(root.text?.fontFamily).toBe("Inter, Helvetica, Arial, sans-serif");
  });

  it("emits an unpadded, unpainted text leaf as a bare TEXT node", () => {
    const scene = box(
      "label",
      { x: 0, y: 0, width: 80, height: 20 },
      {
        kind: "text",
        text: {
          lines: [{ text: "Overview", x: 0, y: 14 }],
          style: {
            fontFamily: "Inter",
            fontSizePx: 13,
            letterSpacingPx: 0.5,
            color: "rgb(0, 0, 0)",
          },
        },
      },
    );
    const { root } = buildFigmaNodeSpec(scene);
    expect(root.type).toBe("TEXT");
    // Figma's SVG importer drops tracking; the node path carries it.
    expect(root.text?.letterSpacingPx).toBe(0.5);
  });
});

describe("buildFigmaNodeSpec — wrapper collapsing", () => {
  const leaf = () =>
    box(
      "leaf",
      { x: 0, y: 0, width: 100, height: 100 },
      {
        fills: [{ kind: "solid", color: "rgb(1, 1, 1)" }],
      },
    );

  it("collapses a paint-neutral single-child wrapper whose box matches its child", () => {
    const scene = box(
      "root",
      { x: 0, y: 0, width: 100, height: 100 },
      {
        fills: [{ kind: "solid", color: "rgb(9, 9, 9)" }],
        children: [
          box(
            "wrapper",
            { x: 0, y: 0, width: 100, height: 100 },
            {
              children: [leaf()],
            },
          ),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(report.wrappersCollapsed).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].id).toBe("leaf");
    expect(report.nodeCountBefore).toBe(3);
    expect(report.nodeCountAfter).toBe(2);
    expect(report.maxDepthBefore).toBe(3);
    expect(report.maxDepthAfter).toBe(2);
  });

  it("collapses a chain of nested pass-through wrappers", () => {
    const scene = box(
      "root",
      { x: 0, y: 0, width: 100, height: 100 },
      {
        fills: [{ kind: "solid", color: "rgb(9, 9, 9)" }],
        children: [
          box(
            "w1",
            { x: 0, y: 0, width: 100, height: 100 },
            {
              children: [
                box(
                  "w2",
                  { x: 0, y: 0, width: 100, height: 100 },
                  {
                    children: [
                      box(
                        "w3",
                        { x: 0, y: 0, width: 100, height: 100 },
                        {
                          children: [leaf()],
                        },
                      ),
                    ],
                  },
                ),
              ],
            },
          ),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(report.wrappersCollapsed).toBe(3);
    expect(root.children[0].id).toBe("leaf");
  });

  it("keeps a wrapper that paints anything", () => {
    for (const paint of [
      { fills: [{ kind: "solid" as const, color: "rgb(2, 2, 2)" }] },
      { border: { widthPx: 1, color: "rgb(0, 0, 0)" } },
      {
        shadows: [
          {
            offsetX: 0,
            offsetY: 2,
            blur: 4,
            spread: 0,
            color: "rgba(0,0,0,.2)",
          },
        ],
      },
      { cornerRadii: { tl: 8, tr: 8, br: 8, bl: 8 } },
      { clipsContent: true },
      { opacity: 0.5 },
      { rotationDeg: 4 },
    ]) {
      const scene = box(
        "root",
        { x: 0, y: 0, width: 100, height: 100 },
        {
          children: [
            box(
              "wrapper",
              { x: 0, y: 0, width: 100, height: 100 },
              {
                ...paint,
                children: [leaf()],
              },
            ),
          ],
        },
      );
      const { report } = buildFigmaNodeSpec(scene);
      expect(report.wrappersCollapsed).toBe(0);
    }
  });

  it("keeps a padded wrapper whose box does not match its single child", () => {
    const scene = box(
      "root",
      { x: 0, y: 0, width: 200, height: 200 },
      {
        // An auto-layout parent, so the wrapper cannot be hoisted either —
        // this isolates the pass-through rule's exact-box requirement.
        layout: facts({ display: "flex", flexDirection: "column" }),
        fills: [{ kind: "solid", color: "rgb(3, 3, 3)" }],
        children: [
          box(
            "wrapper",
            { x: 0, y: 0, width: 200, height: 200 },
            {
              layout: facts({ paddingPx: [50, 50, 50, 50] }),
              children: [
                box(
                  "leaf",
                  { x: 50, y: 50, width: 100, height: 100 },
                  {
                    fills: [{ kind: "solid", color: "rgb(1, 1, 1)" }],
                  },
                ),
              ],
            },
          ),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(report.wrappersCollapsed).toBe(0);
    expect(root.children[0].id).toBe("wrapper");
  });

  it("never collapses a wrapper that carries auto-layout its parent does not", () => {
    const scene = box(
      "root",
      { x: 0, y: 0, width: 216, height: 100 },
      {
        children: [
          box(
            "wrapper",
            { x: 0, y: 0, width: 216, height: 100 },
            {
              layout: facts({
                display: "flex",
                flexDirection: "row",
                columnGapPx: 16,
              }),
              children: [
                box("a", { x: 0, y: 0, width: 100, height: 100 }),
                box("b", { x: 116, y: 0, width: 100, height: 100 }),
              ],
            },
          ),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(report.wrappersCollapsed).toBe(0);
    expect(root.children[0].id).toBe("wrapper");
    expect(root.children[0].layout.mode).toBe("HORIZONTAL");
  });

  it("hoists a paint-neutral wrapper's children into an absolutely-laid-out parent", () => {
    const scene = box(
      "root",
      { x: 0, y: 0, width: 300, height: 300 },
      {
        children: [
          box(
            "wrapper",
            { x: 0, y: 0, width: 300, height: 300 },
            {
              children: [
                box(
                  "a",
                  { x: 10, y: 10, width: 50, height: 50 },
                  {
                    fills: [{ kind: "solid", color: "rgb(1, 1, 1)" }],
                  },
                ),
                box(
                  "b",
                  { x: 80, y: 90, width: 50, height: 50 },
                  {
                    fills: [{ kind: "solid", color: "rgb(2, 2, 2)" }],
                  },
                ),
              ],
            },
          ),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(report.wrappersCollapsed).toBe(1);
    expect(root.children.map((child) => child.id)).toEqual(["a", "b"]);
    // Paint order and geometry both survive the hoist.
    expect(root.children[0].x).toBe(10);
    expect(root.children[1].y).toBe(90);
  });

  it("does not hoist a wrapper out of an auto-layout parent", () => {
    const scene = flexRow();
    scene.children![0] = box(
      "wrapper",
      { x: 20, y: 0, width: 100, height: 100 },
      {
        children: [
          box(
            "x",
            { x: 20, y: 0, width: 40, height: 40 },
            {
              fills: [{ kind: "solid", color: "rgb(1, 1, 1)" }],
            },
          ),
          box(
            "y",
            { x: 70, y: 40, width: 40, height: 40 },
            {
              fills: [{ kind: "solid", color: "rgb(2, 2, 2)" }],
            },
          ),
        ],
      },
    );
    const { root, report } = buildFigmaNodeSpec(scene);
    expect(root.layout.mode).toBe("HORIZONTAL");
    expect(report.wrappersCollapsed).toBe(0);
    expect(root.children[0].id).toBe("wrapper");
  });
});
