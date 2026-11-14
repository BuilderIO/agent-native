import { buildCodeLayerProjection } from "@shared/code-layer";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import {
  alignSelectionAvailability,
  type CommitNodeStylePatches,
  type MeasureAlignSelection,
  planAlignSelection,
  runAlignSelection,
  runSharedLayoutMove,
} from "@/pages/design-editor/commands/align-selection";
import {
  computeDistributedPositions,
  computeTidyPositions,
} from "@/pages/design-editor/layout-operations";
import type {
  AlignMeasurement,
  AutoLayoutParent,
  MeasuredAlignNode,
  OffsetAxis,
  SharedRect,
  StylePatch,
} from "@/pages/design-editor/layout-operations";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const HTML = `<!doctype html>
<html>
  <body style="margin:0">
    <div data-agent-native-node-id="frame" style="width:600px;padding:20px">
      <div data-agent-native-node-id="a" style="width:100px;height:40px;margin-left:30px">A</div>
      <div data-agent-native-node-id="b" style="width:200px;height:50px;margin-left:120px">B</div>
      <div data-agent-native-node-id="c" style="width:150px;height:60px;margin-left:60px">C</div>
    </div>
    <div data-agent-native-node-id="row" style="display:flex">
      <div data-agent-native-node-id="item" style="width:80px;height:40px">Item</div>
    </div>
  </body>
</html>`;

function nodes() {
  const projection = buildCodeLayerProjection(HTML, {
    source: { kind: "design-file", fileId: "file-1" },
  });
  const byStableId = (stableId: string) => {
    const found = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === stableId,
    );
    if (!found) throw new Error(`fixture node ${stableId} not found`);
    return found;
  };
  return {
    all: new Map(projection.nodes.map((node) => [node.id, node])),
    frame: byStableId("frame"),
    a: byStableId("a"),
    b: byStableId("b"),
    c: byStableId("c"),
    row: byStableId("row"),
    item: byStableId("item"),
  };
}

const AUTO: OffsetAxis = {
  start: "auto",
  end: "auto",
  size: "set",
  sizePx: 0,
};
const IDENTITY = { a: 1, b: 0, c: 0, d: 1 };
// The fixture frame's padding box in the screen document: 40px margin + 20px padding.
const FRAME_BOX: SharedRect = { x: 60, y: 60, width: 600, height: 150 };

function flowNode(
  id: string,
  rect: SharedRect,
  overrides: Partial<MeasuredAlignNode> = {},
): MeasuredAlignNode {
  return {
    id,
    rect,
    parentBox: FRAME_BOX,
    parentStableId: "frame",
    offsetToShared: IDENTITY,
    layout: {
      kind: "offset",
      position: "static",
      left: 0,
      top: 0,
      x: AUTO,
      y: AUTO,
    },
    selectedAncestorId: null,
    movesNestedLayers: false,
    ...overrides,
  };
}

const ROW_PARENT: AutoLayoutParent = {
  display: "flex",
  flexDirection: "row",
  flexWrap: "nowrap",
  direction: "ltr",
  justifyContent: "normal",
  alignItems: "normal",
  justifyItems: "normal",
};

function autoLayoutNode(
  id: string,
  parent: Partial<AutoLayoutParent> = {},
  fillsCrossAxis = false,
): MeasuredAlignNode {
  return flowNode(
    id,
    { x: 0, y: 0, width: 80, height: 40 },
    {
      parentStableId: "row",
      layout: {
        kind: "auto-layout-child",
        parent: { ...ROW_PARENT, ...parent },
        fillsCrossAxis,
      },
    },
  );
}

function measuring(measured: MeasuredAlignNode[]): MeasureAlignSelection {
  return (requested) => ({
    status: "measured",
    nodes: requested.map((node) => {
      const found = measured.find((item) => item.id === node.id);
      if (!found) throw new Error(`no fixture measurement for ${node.id}`);
      return found;
    }),
  });
}

const UNMEASURABLE: MeasureAlignSelection = (requested) => ({
  status: "unmeasurable",
  nodeId: requested[0]!.id,
  reason: "not-rendered",
});

function availabilityArgs(
  selectedLayerIds: string[],
  measureSelection: MeasureAlignSelection,
  overrides: Partial<Parameters<typeof alignSelectionAvailability>[0]> = {},
) {
  const fixture = nodes();
  return {
    canEditDesign: true,
    fileIds: ["file-1"],
    measureSelection,
    overviewSelectedScreenIds: [],
    resolveNodesById: () => fixture.all,
    selectedElement: null as ElementInfo | null,
    selectedLayerIds,
    viewMode: "single" as const,
    ...overrides,
  };
}

function runArgs(
  selectedLayerIds: string[],
  measureSelection: MeasureAlignSelection,
  commitResult: ReturnType<CommitNodeStylePatches> = { applied: true },
) {
  const commitNodePositions = vi.fn<CommitNodeStylePatches>(() => commitResult);
  const handleGeometryCommit = vi.fn();
  const args = {
    activeFile: {
      id: "file-1",
      filename: "index.html",
      content: HTML,
    } as never,
    boardFileId: undefined,
    boardFrameGeometry: undefined,
    canEditDesign: true,
    commitNodePositions,
    designDataJsonRef: { current: {} },
    files: [{ id: "file-1" }] as never,
    getActiveFileSelectedNodeIds: () => selectedLayerIds,
    getFreshActiveContent: () => HTML,
    handleGeometryCommit,
    measureSelection,
    overviewScreens: [] as never,
    overviewSelectedScreenIds: [] as string[],
    selectedElement: null,
    selectedLayerIdsState: selectedLayerIds,
    t: (key: string) => key,
    viewModeRef: { current: "single" as const },
  };
  return { args, commitNodePositions, handleGeometryCommit };
}

function patchOf(
  plan: ReturnType<typeof planAlignSelection>,
  nodeId: string,
): StylePatch | undefined {
  if (plan.kind !== "offsets") throw new Error(`plan is ${plan.kind}`);
  return plan.patches.get(nodeId);
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe("alignSelectionAvailability", () => {
  it("allows a lone in-flow layer whose parent is not positioned", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs(
          [fixture.b.id],
          measuring([
            flowNode(fixture.b.id, { x: 180, y: 100, width: 200, height: 50 }),
          ]),
        ),
      ),
    ).toEqual({ canAlign: true });
  });

  it("allows a lone top-level layer, which aligns to the screen", () => {
    const fixture = nodes();
    const screen = { x: 0, y: 0, width: 1200, height: 760 };
    expect(
      alignSelectionAvailability(
        availabilityArgs(
          [fixture.frame.id],
          measuring([
            flowNode(fixture.frame.id, FRAME_BOX, {
              parentBox: screen,
              parentStableId: null,
            }),
          ]),
        ),
      ),
    ).toEqual({ canAlign: true });
  });

  it("refuses a lone top-level board layer, which has nothing to align against", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs(
          [fixture.frame.id],
          measuring([
            flowNode(fixture.frame.id, FRAME_BOX, {
              parentBox: null,
              parentStableId: null,
            }),
          ]),
        ),
      ),
    ).toEqual({ canAlign: false, blocker: "no-alignable-parent" });
  });

  it("refuses a selection it cannot measure instead of treating it as zero", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs([fixture.a.id, fixture.c.id], UNMEASURABLE),
      ),
    ).toEqual({ canAlign: false, blocker: "unmeasurable" });
  });

  it("allows a lone auto layout child, which aligns its frame", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs(
          [fixture.item.id],
          measuring([autoLayoutNode(fixture.item.id)]),
        ),
      ),
    ).toEqual({ canAlign: true });
  });

  it("refuses several auto layout children, whose frame places them", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs(
          [fixture.item.id, fixture.a.id],
          measuring([
            autoLayoutNode(fixture.item.id),
            flowNode(fixture.a.id, { x: 90, y: 60, width: 100, height: 40 }),
          ]),
        ),
      ),
    ).toEqual({ canAlign: false, blocker: "auto-layout-children" });
  });

  it("refuses sticky layers", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs(
          [fixture.a.id],
          measuring([
            flowNode(
              fixture.a.id,
              { x: 90, y: 60, width: 100, height: 40 },
              { layout: { kind: "unsupported" } },
            ),
          ]),
        ),
      ),
    ).toEqual({ canAlign: false, blocker: "unsupported-position" });
  });

  it("refuses an empty selection and a read-only design", () => {
    expect(
      alignSelectionAvailability(availabilityArgs([], UNMEASURABLE)),
    ).toEqual({ canAlign: false, blocker: "no-selection" });
    expect(
      alignSelectionAvailability(
        availabilityArgs([], UNMEASURABLE, { canEditDesign: false }),
      ),
    ).toEqual({ canAlign: false, blocker: "read-only" });
  });

  it("needs two screens in overview, where the selection is screens not layers", () => {
    expect(
      alignSelectionAvailability(
        availabilityArgs([], UNMEASURABLE, {
          viewMode: "overview",
          overviewSelectedScreenIds: ["file-1"],
        }),
      ),
    ).toEqual({ canAlign: false, blocker: "overview-needs-two-screens" });
    expect(
      alignSelectionAvailability(
        availabilityArgs([], UNMEASURABLE, {
          viewMode: "overview",
          overviewSelectedScreenIds: ["file-1", "file-2"],
        }),
      ),
    ).toEqual({ canAlign: true });
  });
});

describe("planAlignSelection", () => {
  it("moves a lone in-flow layer inside its parent with a relative offset", () => {
    const plan = planAlignSelection(
      [flowNode("b", { x: 180, y: 100, width: 200, height: 50 })],
      "right",
    );
    // Parent right edge 660 minus width 200 is 460; it starts at 180.
    expect(patchOf(plan, "b")).toEqual([
      ["position", "relative"],
      ["left", "280px"],
    ]);
  });

  it("aligns several in-flow layers to their bounding box without taking any out of flow", () => {
    const plan = planAlignSelection(
      [
        flowNode("a", { x: 90, y: 60, width: 100, height: 40 }),
        flowNode("c", { x: 120, y: 150, width: 150, height: 60 }),
      ],
      "left",
    );
    expect(plan.kind).toBe("offsets");
    expect(patchOf(plan, "a")).toBeUndefined();
    expect(patchOf(plan, "c")).toEqual([
      ["position", "relative"],
      ["left", "-30px"],
    ]);
    for (const patch of plan.kind === "offsets" ? plan.patches.values() : []) {
      expect(patch).not.toContainEqual(["position", "absolute"]);
      expect(patch.map(([property]) => property)).not.toContain("top");
    }
  });

  it("adds to a relative layer's existing offset", () => {
    const plan = planAlignSelection(
      [
        flowNode(
          "b",
          { x: 190, y: 100, width: 200, height: 50 },
          {
            layout: {
              kind: "offset",
              position: "relative",
              left: 10,
              top: 5,
              x: { ...AUTO, start: "set" },
              y: { ...AUTO, start: "set" },
            },
          },
        ),
      ],
      "left",
    );
    expect(patchOf(plan, "b")).toEqual([["left", "-120px"]]);
  });

  it("neutralizes inert offsets a static layer had, so turning it relative moves only the aligned axis", () => {
    const plan = planAlignSelection(
      [
        flowNode(
          "b",
          { x: 180, y: 100, width: 200, height: 50 },
          {
            layout: {
              kind: "offset",
              position: "static",
              left: 0,
              top: 0,
              x: AUTO,
              y: { ...AUTO, start: "set", end: "unknown" },
            },
          },
        ),
      ],
      "left",
    );
    expect(patchOf(plan, "b")).toEqual([
      ["position", "relative"],
      ["left", "-120px"],
      ["top", "0px"],
      ["bottom", "auto"],
    ]);
  });

  it("converts a right-anchored absolute layer to left and keeps its width", () => {
    const plan = planAlignSelection(
      [
        flowNode(
          "chip",
          { x: 400, y: 100, width: 120, height: 60 },
          {
            layout: {
              kind: "offset",
              position: "absolute",
              left: 340,
              top: 40,
              x: { start: "set", end: "set", size: "auto", sizePx: 120 },
              y: { start: "set", end: "auto", size: "set", sizePx: 60 },
            },
          },
        ),
      ],
      "left",
    );
    expect(patchOf(plan, "chip")).toEqual([
      ["left", "0px"],
      ["right", "auto"],
      ["width", "120px"],
    ]);
  });

  it("maps shared-space motion through a scaled parent", () => {
    const plan = planAlignSelection(
      [
        flowNode(
          "inner",
          { x: 200, y: 50, width: 240, height: 30 },
          {
            parentBox: { x: 0, y: 0, width: 1600, height: 300 },
            offsetToShared: { a: 2, b: 0, c: 0, d: 0.5 },
            layout: {
              kind: "offset",
              position: "absolute",
              left: 100,
              top: 100,
              x: { start: "set", end: "auto", size: "set", sizePx: 120 },
              y: { start: "set", end: "auto", size: "set", sizePx: 60 },
            },
          },
        ),
      ],
      "right",
    );
    expect(patchOf(plan, "inner")).toEqual([["left", "680px"]]);
  });

  it("does not double-move a layer whose selected ancestor already carries it", () => {
    const plan = planAlignSelection(
      [
        flowNode("frame", { x: 100, y: 0, width: 400, height: 200 }),
        flowNode(
          "child",
          { x: 150, y: 20, width: 100, height: 40 },
          { selectedAncestorId: "frame" },
        ),
        flowNode("other", { x: 20, y: 300, width: 50, height: 50 }),
      ],
      "left",
    );
    // Bounds start at 20. The frame moves -80, which carries the child to 70;
    // the child moves the remaining -50 itself.
    expect(patchOf(plan, "frame")).toEqual([
      ["position", "relative"],
      ["left", "-80px"],
    ]);
    expect(patchOf(plan, "child")).toEqual([
      ["position", "relative"],
      ["left", "-50px"],
    ]);
  });

  it("lands on whole pixels", () => {
    const plan = planAlignSelection(
      [flowNode("b", { x: 180.3, y: 100, width: 201, height: 50 })],
      "center-h",
    );
    // Center of 60..660 is 360; (600 - 201) / 2 + 60 = 259.5, from 180.3.
    expect(patchOf(plan, "b")).toEqual([
      ["position", "relative"],
      ["left", "79px"],
    ]);
  });

  it("refuses to re-anchor absolutely positioned layers nested in a static layer", () => {
    expect(
      planAlignSelection(
        [
          flowNode(
            "card",
            { x: 180, y: 100, width: 200, height: 50 },
            { movesNestedLayers: true },
          ),
        ],
        "left",
      ),
    ).toEqual({ kind: "refused", refusal: "moves-nested-layers" });
  });

  describe("a lone auto layout child aligns its frame", () => {
    it("on the main axis with justify-content", () => {
      expect(planAlignSelection([autoLayoutNode("item")], "right")).toEqual({
        kind: "parent-alignment",
        patch: [["justify-content", "flex-end"]],
      });
    });

    it("on the cross axis with align-items", () => {
      expect(planAlignSelection([autoLayoutNode("item")], "center-v")).toEqual({
        kind: "parent-alignment",
        patch: [["align-items", "center"]],
      });
    });

    it("swaps axes for a column", () => {
      expect(
        planAlignSelection(
          [autoLayoutNode("item", { flexDirection: "column" })],
          "bottom",
        ),
      ).toEqual({
        kind: "parent-alignment",
        patch: [["justify-content", "flex-end"]],
      });
      expect(
        planAlignSelection(
          [autoLayoutNode("item", { flexDirection: "column" })],
          "right",
        ),
      ).toEqual({
        kind: "parent-alignment",
        patch: [["align-items", "flex-end"]],
      });
    });

    it("flips for row-reverse and right-to-left text", () => {
      expect(
        planAlignSelection(
          [
            autoLayoutNode("item", {
              flexDirection: "row-reverse",
              justifyContent: "flex-end",
            }),
          ],
          "right",
        ),
      ).toEqual({
        kind: "parent-alignment",
        patch: [["justify-content", "flex-start"]],
      });
      expect(
        planAlignSelection(
          [autoLayoutNode("item", { direction: "rtl" })],
          "left",
        ),
      ).toEqual({
        kind: "parent-alignment",
        patch: [["justify-content", "flex-end"]],
      });
    });

    it("is a no-op when the frame already aligns that way", () => {
      expect(planAlignSelection([autoLayoutNode("item")], "left")).toEqual({
        kind: "parent-alignment",
        patch: [],
      });
    });

    it("leaves a stretched child's cross axis alone instead of shrinking it", () => {
      expect(
        planAlignSelection([autoLayoutNode("item", {}, true)], "top"),
      ).toEqual({ kind: "parent-alignment", patch: [] });
    });
  });
});

describe("runAlignSelection", () => {
  it("refuses, and says so, when any selected layer cannot be measured", () => {
    const fixture = nodes();
    const { args, commitNodePositions } = runArgs(
      [fixture.a.id, fixture.c.id],
      UNMEASURABLE,
    );
    runAlignSelection(args, "left");
    expect(commitNodePositions).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.layoutUnmeasurable",
      expect.anything(),
    );
  });

  it("explains a refused hotkey instead of doing nothing silently", () => {
    const fixture = nodes();
    const { args, commitNodePositions } = runArgs(
      [fixture.item.id, fixture.a.id],
      measuring([
        autoLayoutNode(fixture.item.id),
        flowNode(fixture.a.id, { x: 90, y: 60, width: 100, height: 40 }),
      ]),
    );
    runAlignSelection(args, "left");
    expect(commitNodePositions).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.layoutAutoLayoutChildren",
      expect.anything(),
    );
  });

  it("commits only the selected layers that move", () => {
    const fixture = nodes();
    const { args, commitNodePositions } = runArgs(
      [fixture.a.id, fixture.c.id],
      measuring([
        flowNode(fixture.a.id, { x: 90, y: 60, width: 100, height: 40 }),
        flowNode(fixture.c.id, { x: 120, y: 150, width: 150, height: 60 }),
      ]),
    );
    runAlignSelection(args, "left");
    expect(commitNodePositions.mock.calls[0]![1]).toEqual(
      new Map([
        [
          fixture.c.id,
          [
            ["position", "relative"],
            ["left", "-30px"],
          ],
        ],
      ]),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("writes a lone auto layout child's alignment on its frame", () => {
    const fixture = nodes();
    const { args, commitNodePositions } = runArgs(
      [fixture.item.id],
      measuring([autoLayoutNode(fixture.item.id)]),
    );
    runAlignSelection(args, "center-h");
    expect(commitNodePositions.mock.calls[0]![1]).toEqual(
      new Map([[fixture.row.id, [["justify-content", "center"]]]]),
    );
  });

  it("reports a commit the source editor refused", () => {
    const fixture = nodes();
    const { args } = runArgs(
      [fixture.b.id],
      measuring([
        flowNode(fixture.b.id, { x: 180, y: 100, width: 200, height: 50 }),
      ]),
      { applied: false },
    );
    runAlignSelection(args, "right");
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.layoutMoveFailed",
      expect.anything(),
    );
  });

  it("measures once per run", () => {
    const fixture = nodes();
    const measure = vi.fn<MeasureAlignSelection>(
      (requested): AlignMeasurement =>
        measuring([
          flowNode(fixture.b.id, { x: 180, y: 100, width: 200, height: 50 }),
        ])(requested),
    );
    const { args } = runArgs([fixture.b.id], measure);
    runAlignSelection(args, "right");
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure.mock.calls[0]![1]).toEqual({ checkNestedLayers: true });
  });
});

describe("runSharedLayoutMove", () => {
  const source = { kind: "design-file" as const, fileId: "file-1" };

  it("distributes measured layers in one shared space", () => {
    const fixture = nodes();
    const commitNodePositions = vi.fn<CommitNodeStylePatches>(() => ({
      applied: true,
    }));
    runSharedLayoutMove({
      baseContent: HTML,
      commitNodePositions,
      measureSelection: measuring([
        flowNode(fixture.a.id, { x: 90, y: 60, width: 100, height: 40 }),
        flowNode(fixture.b.id, { x: 180, y: 100, width: 200, height: 50 }),
        flowNode(fixture.c.id, { x: 120, y: 150, width: 150, height: 60 }),
      ]),
      nodes: [fixture.a, fixture.b, fixture.c],
      source,
      t: (key) => key,
      targets: (rects) => computeDistributedPositions(rects, "vertical"),
      traceName: "distribute",
    });
    // Span 60..210 holds 150px of layers, so no gaps: b moves to 100, already there.
    expect(commitNodePositions).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("tidies without taking layers out of flow", () => {
    const fixture = nodes();
    const commitNodePositions = vi.fn<CommitNodeStylePatches>(() => ({
      applied: true,
    }));
    runSharedLayoutMove({
      baseContent: HTML,
      commitNodePositions,
      measureSelection: measuring([
        flowNode(fixture.a.id, { x: 90, y: 60, width: 100, height: 40 }),
        flowNode(fixture.c.id, { x: 120, y: 150, width: 100, height: 40 }),
      ]),
      nodes: [fixture.a, fixture.c],
      source,
      t: (key) => key,
      targets: computeTidyPositions,
      traceName: "tidy",
    });
    const patches = commitNodePositions.mock.calls[0]![1];
    expect([...patches.keys()]).toEqual([fixture.c.id]);
    expect(patches.get(fixture.c.id)).toContainEqual(["position", "relative"]);
    expect(patches.get(fixture.c.id)).not.toContainEqual([
      "position",
      "absolute",
    ]);
  });

  it("refuses an unmeasurable selection with the shared toast", () => {
    const fixture = nodes();
    const commitNodePositions = vi.fn<CommitNodeStylePatches>();
    runSharedLayoutMove({
      baseContent: HTML,
      commitNodePositions,
      measureSelection: UNMEASURABLE,
      nodes: [fixture.a, fixture.b, fixture.c],
      source,
      t: (key) => key,
      targets: computeTidyPositions,
      traceName: "tidy",
    });
    expect(commitNodePositions).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.layoutUnmeasurable",
      expect.anything(),
    );
  });
});
