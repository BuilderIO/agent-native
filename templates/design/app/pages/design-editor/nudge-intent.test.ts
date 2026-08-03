import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  countGridTracks,
  declaredFlexOrder,
  DEFAULT_NUDGE_AMOUNTS,
  describeFlowContainer,
  escapesFlow,
  NO_FLOW_CONTAINER,
  reorderAnchorFor,
  resolveElementNudgeIntent,
  resolveNudgeIntent,
  type FlowContainerInfo,
} from "./nudge-intent";

const flexRow = describeFlowContainer({ style: { display: "flex" } });
const flexColumn = describeFlowContainer({
  style: { display: "flex", "flex-direction": "column" },
});

describe("describeFlowContainer", () => {
  it("reads a flex row from inline styles", () => {
    expect(flexRow).toEqual<FlowContainerInfo>({
      kind: "flex",
      axis: "horizontal",
      reversed: false,
      wraps: false,
      lineLength: null,
    });
  });

  it("reads a flex column from Tailwind utilities", () => {
    expect(
      describeFlowContainer({ style: {}, classes: ["flex", "flex-col"] }),
    ).toMatchObject({ kind: "flex", axis: "vertical", reversed: false });
  });

  it("marks row-reverse and column-reverse as reversed", () => {
    expect(
      describeFlowContainer({
        style: { display: "flex", "flex-direction": "row-reverse" },
      }),
    ).toMatchObject({ axis: "horizontal", reversed: true });
    expect(
      describeFlowContainer({
        style: {},
        classes: ["flex", "flex-col-reverse"],
      }),
    ).toMatchObject({ axis: "vertical", reversed: true });
  });

  it("detects wrap and wrap-reverse", () => {
    expect(
      describeFlowContainer({
        style: { display: "flex", "flex-wrap": "wrap" },
      }),
    ).toMatchObject({ wraps: true });
    expect(
      describeFlowContainer({
        style: {},
        classes: ["flex", "flex-wrap-reverse"],
      }),
    ).toMatchObject({ wraps: true });
  });

  it("counts grid columns from a template and from grid-cols-N", () => {
    expect(
      describeFlowContainer({
        style: { display: "grid", "grid-template-columns": "repeat(4, 1fr)" },
      }),
    ).toMatchObject({ kind: "grid", axis: "horizontal", lineLength: 4 });
    expect(
      describeFlowContainer({ style: {}, classes: ["grid", "grid-cols-3"] }),
    ).toMatchObject({ kind: "grid", lineLength: 3 });
  });

  it("uses row tracks as the line length when the grid flows by column", () => {
    expect(
      describeFlowContainer({
        style: {
          display: "grid",
          "grid-auto-flow": "column",
          "grid-template-rows": "1fr 1fr",
        },
      }),
    ).toMatchObject({ axis: "vertical", lineLength: 2 });
  });

  it("ignores breakpoint-prefixed utilities", () => {
    expect(
      describeFlowContainer({ style: {}, classes: ["md:flex", "md:flex-col"] }),
    ).toEqual(NO_FLOW_CONTAINER);
  });

  it("treats block and missing parents as no container", () => {
    expect(describeFlowContainer({ style: { display: "block" } })).toEqual(
      NO_FLOW_CONTAINER,
    );
    expect(describeFlowContainer(null)).toEqual(NO_FLOW_CONTAINER);
  });
});

describe("countGridTracks", () => {
  it("counts explicit tracks", () => {
    expect(countGridTracks("1fr 2fr 1fr")).toBe(3);
  });

  it("expands repeat()", () => {
    expect(countGridTracks("repeat(6, minmax(0, 1fr))")).toBe(6);
  });

  it("does not split inside function arguments", () => {
    expect(countGridTracks("minmax(120px, 1fr) minmax(120px, 1fr)")).toBe(2);
  });

  it("multiplies nested repeat groups", () => {
    expect(countGridTracks("repeat(2, 1fr 2fr)")).toBe(4);
  });

  it("returns null for none/empty", () => {
    expect(countGridTracks("none")).toBeNull();
    expect(countGridTracks(undefined)).toBeNull();
  });
});

describe("escapesFlow", () => {
  it("is true only for absolute and fixed", () => {
    expect(escapesFlow("absolute")).toBe(true);
    expect(escapesFlow("fixed")).toBe(true);
    expect(escapesFlow("relative")).toBe(false);
    expect(escapesFlow("sticky")).toBe(false);
    expect(escapesFlow(undefined)).toBe(false);
  });

  it("reads the Tailwind position utility when no style is authored", () => {
    expect(escapesFlow(undefined, ["absolute"])).toBe(true);
    expect(escapesFlow(undefined, ["relative"])).toBe(false);
  });
});

describe("resolveNudgeIntent — free-placed objects", () => {
  it("translates by the small amount and by the big amount with shift", () => {
    expect(
      resolveNudgeIntent({ direction: "right", largeStep: false }),
    ).toEqual({ kind: "translate", dx: 1, dy: 0 });
    expect(resolveNudgeIntent({ direction: "up", largeStep: true })).toEqual({
      kind: "translate",
      dx: 0,
      dy: -10,
    });
  });

  it("honours configured nudge amounts", () => {
    expect(
      resolveNudgeIntent({
        direction: "down",
        largeStep: true,
        amounts: { small: 2, big: 8 },
      }),
    ).toEqual({ kind: "translate", dx: 0, dy: 8 });
    expect(
      resolveNudgeIntent({
        direction: "left",
        largeStep: false,
        amounts: { small: 2, big: 8 },
      }),
    ).toEqual({ kind: "translate", dx: -2, dy: 0 });
  });

  it("translates a flow child that opted out with position: absolute", () => {
    expect(
      resolveNudgeIntent({
        direction: "right",
        largeStep: false,
        container: flexRow,
        position: "absolute",
        siblingIndex: 0,
        siblingCount: 3,
      }),
    ).toEqual({ kind: "translate", dx: 1, dy: 0 });
  });
});

describe("resolveNudgeIntent — auto layout children", () => {
  const inRow = (direction: "left" | "right" | "up" | "down", index: number) =>
    resolveNudgeIntent({
      direction,
      largeStep: false,
      container: flexRow,
      siblingIndex: index,
      siblingCount: 3,
    });

  it("reorders along the flow axis of a row", () => {
    expect(inRow("right", 0)).toEqual({
      kind: "reorder",
      fromIndex: 0,
      toIndex: 1,
    });
    expect(inRow("left", 2)).toEqual({
      kind: "reorder",
      fromIndex: 2,
      toIndex: 1,
    });
  });

  it("does nothing on the cross axis of a non-wrapping row", () => {
    expect(inRow("up", 1)).toEqual({ kind: "none" });
    expect(inRow("down", 1)).toEqual({ kind: "none" });
  });

  it("does nothing at the ends of the flow instead of translating", () => {
    expect(inRow("left", 0)).toEqual({ kind: "none" });
    expect(inRow("right", 2)).toEqual({ kind: "none" });
  });

  it("reorders along the flow axis of a column", () => {
    expect(
      resolveNudgeIntent({
        direction: "down",
        largeStep: false,
        container: flexColumn,
        siblingIndex: 0,
        siblingCount: 4,
      }),
    ).toEqual({ kind: "reorder", fromIndex: 0, toIndex: 1 });
  });

  it("inverts DOM movement for row-reverse so the arrow matches the screen", () => {
    const rowReverse = describeFlowContainer({
      style: { display: "flex", "flex-direction": "row-reverse" },
    });
    expect(
      resolveNudgeIntent({
        direction: "right",
        largeStep: false,
        container: rowReverse,
        siblingIndex: 1,
        siblingCount: 3,
      }),
    ).toEqual({ kind: "reorder", fromIndex: 1, toIndex: 0 });
  });

  it("ignores shift — a reorder is always one position", () => {
    expect(
      resolveNudgeIntent({
        direction: "right",
        largeStep: true,
        container: flexRow,
        siblingIndex: 0,
        siblingCount: 5,
      }),
    ).toEqual({ kind: "reorder", fromIndex: 0, toIndex: 1 });
  });

  it("does nothing when the container holds a single child", () => {
    expect(
      resolveNudgeIntent({
        direction: "right",
        largeStep: false,
        container: flexRow,
        siblingIndex: 0,
        siblingCount: 1,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does nothing when the sibling position is unknown", () => {
    expect(
      resolveNudgeIntent({
        direction: "right",
        largeStep: false,
        container: flexRow,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("resolveNudgeIntent — wrapping and grid", () => {
  it("moves a whole grid row on the cross axis", () => {
    const grid = describeFlowContainer({
      style: { display: "grid", "grid-template-columns": "repeat(3, 1fr)" },
    });
    expect(
      resolveNudgeIntent({
        direction: "down",
        largeStep: false,
        container: grid,
        siblingIndex: 1,
        siblingCount: 9,
      }),
    ).toEqual({ kind: "reorder", fromIndex: 1, toIndex: 4 });
    expect(
      resolveNudgeIntent({
        direction: "up",
        largeStep: false,
        container: grid,
        siblingIndex: 7,
        siblingCount: 9,
      }),
    ).toEqual({ kind: "reorder", fromIndex: 7, toIndex: 4 });
  });

  it("clamps a cross-axis move to the last sibling instead of overshooting", () => {
    const grid = describeFlowContainer({
      style: { display: "grid", "grid-template-columns": "repeat(3, 1fr)" },
    });
    expect(
      resolveNudgeIntent({
        direction: "down",
        largeStep: false,
        container: grid,
        siblingIndex: 5,
        siblingCount: 7,
      }),
    ).toEqual({ kind: "reorder", fromIndex: 5, toIndex: 6 });
  });

  it("does nothing across lines when the line length cannot be measured", () => {
    const wrapRow = describeFlowContainer({
      style: { display: "flex", "flex-wrap": "wrap" },
    });
    expect(
      resolveNudgeIntent({
        direction: "down",
        largeStep: false,
        container: wrapRow,
        siblingIndex: 0,
        siblingCount: 8,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("reorderAnchorFor", () => {
  it("anchors after the destination sibling when moving later", () => {
    expect(reorderAnchorFor({ fromIndex: 0, toIndex: 1 })).toEqual({
      anchorIndex: 1,
      placement: "after",
    });
  });

  it("anchors before the destination sibling when moving earlier", () => {
    expect(reorderAnchorFor({ fromIndex: 3, toIndex: 2 })).toEqual({
      anchorIndex: 2,
      placement: "before",
    });
  });
});

describe("declaredFlexOrder", () => {
  it("reads an inline order", () => {
    expect(declaredFlexOrder({ style: { order: "3" } })).toBe(3);
  });

  it("reads Tailwind order utilities", () => {
    expect(declaredFlexOrder({ style: {}, classes: ["order-2"] })).toBe(2);
    expect(declaredFlexOrder({ style: {}, classes: ["order-first"] })).toBe(
      -9999,
    );
    expect(declaredFlexOrder({ style: {}, classes: ["order-last"] })).toBe(
      9999,
    );
    expect(declaredFlexOrder({ style: {}, classes: ["order-none"] })).toBe(0);
  });

  it("is null when the child leaves order at the default", () => {
    expect(declaredFlexOrder({ style: {} })).toBeNull();
    expect(
      declaredFlexOrder({ style: {}, classes: ["flex", "p-4"] }),
    ).toBeNull();
  });
});

describe("DEFAULT_NUDGE_AMOUNTS", () => {
  it("matches Figma's 1px / 10px defaults", () => {
    expect(DEFAULT_NUDGE_AMOUNTS).toEqual({ small: 1, big: 10 });
  });
});

function elementInfoFor(
  nodeId: string,
  tagName = "div",
  parentDisplay?: string,
): ElementInfo {
  return {
    tagName,
    sourceId: nodeId,
    selector: `[data-agent-native-node-id="${nodeId}"]`,
    classes: [],
    computedStyles: {},
    parentDisplay,
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as ElementInfo;
}

/** Apply the resolved intent the way handleNudgeSelection does, and report the
 * resulting DOM order so a test asserts the visible outcome, not the plan. */
function orderAfterNudge(
  content: string,
  nodeId: string,
  direction: "up" | "right" | "down" | "left",
): string[] | { kind: string } {
  const intent = resolveElementNudgeIntent({
    content,
    selectedElement: elementInfoFor(nodeId),
    direction,
    largeStep: false,
  });
  if (intent.kind !== "reorder") return { kind: intent.kind };
  const patch = applyVisualEdit(intent.content, {
    kind: "moveNode",
    target: { nodeId: intent.targetNodeId },
    anchor: { nodeId: intent.anchorNodeId },
    placement: intent.placement,
  });
  expect(patch.result.status).toBe("applied");
  const projection = buildCodeLayerProjection(patch.content);
  const parent = projection.nodes.find((node) => node.tag === "section");
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  return (parent?.children ?? []).map(
    (childId) =>
      byId.get(childId)?.dataAttributes["data-agent-native-node-id"] ?? "?",
  );
}

const ROW_SCREEN = `<!doctype html><html><body>
  <section data-agent-native-node-id="row" style="display:flex;flex-direction:row">
    <div data-agent-native-node-id="alpha">Alpha</div>
    <div data-agent-native-node-id="beta">Beta</div>
    <div data-agent-native-node-id="gamma">Gamma</div>
  </section>
</body></html>`;

describe("resolveElementNudgeIntent", () => {
  it("moves an auto layout child later in the flow on ArrowRight", () => {
    expect(orderAfterNudge(ROW_SCREEN, "alpha", "right")).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("moves an auto layout child earlier in the flow on ArrowLeft", () => {
    expect(orderAfterNudge(ROW_SCREEN, "gamma", "left")).toEqual([
      "alpha",
      "gamma",
      "beta",
    ]);
  });

  it("leaves the flow untouched on the cross axis of a row", () => {
    expect(orderAfterNudge(ROW_SCREEN, "beta", "up")).toEqual({
      kind: "none",
    });
  });

  it("leaves the flow untouched at the end of the flow", () => {
    expect(orderAfterNudge(ROW_SCREEN, "gamma", "right")).toEqual({
      kind: "none",
    });
  });

  it("reorders a Tailwind flex column with ArrowDown", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="col" class="flex flex-col gap-4">
        <div data-agent-native-node-id="alpha">Alpha</div>
        <div data-agent-native-node-id="beta">Beta</div>
      </section>
    </body></html>`;
    expect(orderAfterNudge(content, "alpha", "down")).toEqual([
      "beta",
      "alpha",
    ]);
  });

  it("moves a grid item a whole row on the cross axis", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="grid" class="grid grid-cols-2">
        <div data-agent-native-node-id="a">A</div>
        <div data-agent-native-node-id="b">B</div>
        <div data-agent-native-node-id="c">C</div>
        <div data-agent-native-node-id="d">D</div>
      </section>
    </body></html>`;
    expect(orderAfterNudge(content, "a", "down")).toEqual(["b", "c", "a", "d"]);
  });

  it("translates a child that opted out of the flow with position: absolute", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="row" style="display:flex">
        <div data-agent-native-node-id="alpha" style="position:absolute;left:0;top:0">Alpha</div>
        <div data-agent-native-node-id="beta">Beta</div>
      </section>
    </body></html>`;
    expect(
      resolveElementNudgeIntent({
        content,
        selectedElement: elementInfoFor("alpha"),
        direction: "right",
        largeStep: false,
      }),
    ).toEqual({ kind: "translate", dx: 1, dy: 0 });
  });

  it("translates a free-placed child of a plain block container", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="stack">
        <div data-agent-native-node-id="alpha">Alpha</div>
        <div data-agent-native-node-id="beta">Beta</div>
      </section>
    </body></html>`;
    expect(
      resolveElementNudgeIntent({
        content,
        selectedElement: elementInfoFor("alpha"),
        direction: "down",
        largeStep: true,
      }),
    ).toEqual({ kind: "translate", dx: 0, dy: 10 });
  });

  it("translates rather than swallowing the key when the node cannot be resolved", () => {
    expect(
      resolveElementNudgeIntent({
        content: ROW_SCREEN,
        selectedElement: elementInfoFor("not-in-this-document", "span"),
        direction: "right",
        largeStep: false,
      }),
    ).toEqual({ kind: "translate", dx: 1, dy: 0 });
  });

  it("does nothing when rendered CSS says the parent is a flow container the parser cannot see", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="row" class="row">
        <div data-agent-native-node-id="alpha">Alpha</div>
        <div data-agent-native-node-id="beta">Beta</div>
      </section>
    </body></html>`;
    // `.row { display: flex }` lives in a stylesheet, so describeFlowContainer
    // sees no container — but the bridge reports the rendered display.
    expect(
      resolveElementNudgeIntent({
        content,
        selectedElement: elementInfoFor("alpha", "div", "flex"),
        direction: "right",
        largeStep: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("still translates an absolute child whose parent renders as flex", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="row" class="row">
        <div data-agent-native-node-id="alpha" style="position:absolute;left:0;top:0">Alpha</div>
        <div data-agent-native-node-id="beta">Beta</div>
      </section>
    </body></html>`;
    expect(
      resolveElementNudgeIntent({
        content,
        selectedElement: elementInfoFor("alpha", "div", "flex"),
        direction: "right",
        largeStep: false,
      }),
    ).toEqual({ kind: "translate", dx: 1, dy: 0 });
  });

  it("does nothing when a sibling declares a CSS order the DOM move cannot express", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="row" style="display:flex">
        <div data-agent-native-node-id="alpha" style="order:2">Alpha</div>
        <div data-agent-native-node-id="beta" style="order:1">Beta</div>
        <div data-agent-native-node-id="gamma">Gamma</div>
      </section>
    </body></html>`;
    expect(
      resolveElementNudgeIntent({
        content,
        selectedElement: elementInfoFor("alpha"),
        direction: "right",
        largeStep: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("still reorders when order-none is the only declaration", () => {
    const content = `<!doctype html><html><body>
      <section data-agent-native-node-id="row" style="display:flex">
        <div data-agent-native-node-id="alpha" class="order-none">Alpha</div>
        <div data-agent-native-node-id="beta">Beta</div>
      </section>
    </body></html>`;
    expect(
      resolveElementNudgeIntent({
        content,
        selectedElement: elementInfoFor("alpha"),
        direction: "right",
        largeStep: false,
      }),
    ).toMatchObject({ kind: "reorder" });
  });

  it("translates when there is no authored source to reorder against", () => {
    expect(
      resolveElementNudgeIntent({
        content: "",
        selectedElement: elementInfoFor("alpha"),
        direction: "left",
        largeStep: false,
      }),
    ).toEqual({ kind: "translate", dx: -1, dy: 0 });
  });

  it("honours configured nudge amounts on the translate fallback", () => {
    expect(
      resolveElementNudgeIntent({
        content: "",
        selectedElement: elementInfoFor("alpha"),
        direction: "right",
        largeStep: true,
        amounts: { small: 2, big: 8 },
      }),
    ).toEqual({ kind: "translate", dx: 8, dy: 0 });
  });
});
