import { buildCodeLayerProjection } from "@shared/code-layer";
import type { CodeLayerNode } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import {
  alignSelectionAvailability,
  runAlignSelection,
} from "@/pages/design-editor/commands/align-selection";
import type { AlignableRect } from "@/pages/design-editor/layout-operations";

const HTML = `<!doctype html>
<html>
  <body style="margin:0">
    <div style="position:relative;width:800px;height:600px">
      <div style="position:absolute;left:300px;top:250px;width:120px;height:60px">Abs</div>
    </div>
    <div style="max-width:720px;margin:0 auto;display:flex;flex-direction:column">
      <div style="width:100px;height:50px">Flow</div>
    </div>
  </body>
</html>`;

function nodes() {
  const projection = buildCodeLayerProjection(HTML);
  const byTag = (predicate: (node: CodeLayerNode) => boolean) => {
    const found = projection.nodes.find(predicate);
    if (!found) throw new Error("fixture node not found");
    return found;
  };
  return {
    all: new Map(projection.nodes.map((node) => [node.id, node])),
    body: byTag((node) => node.tag === "body"),
    frame: byTag((node) => node.style.width === "800px"),
    absChild: byTag((node) => node.style.left === "300px"),
    unsizedParent: byTag((node) => node.style["max-width"] === "720px"),
    flowChild: byTag((node) => node.style.width === "100px"),
  };
}

function rectFromCodeLayerNode(node: CodeLayerNode): AlignableRect {
  const num = (value: string | undefined) => Number.parseFloat(value ?? "");
  const resolve = (value: number) => (Number.isFinite(value) ? value : 0);
  return {
    id: node.id,
    x: resolve(num(node.style.left)),
    y: resolve(num(node.style.top)),
    width: resolve(num(node.style.width)),
    height: resolve(num(node.style.height)),
  };
}

function availabilityArgs(
  selectedLayerIds: string[],
  overrides: Partial<Parameters<typeof alignSelectionAvailability>[0]> = {},
) {
  const fixture = nodes();
  return {
    canEditDesign: true,
    fileIds: ["file-1"],
    measureAlignParentBox: () => ({ width: 800, height: 600 }),
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
  overrides: Partial<Parameters<typeof runAlignSelection>[0]> = {},
) {
  const commitNodePositions = vi.fn(
    (
      _baseContent: string,
      _positions: ReadonlyMap<string, { x: number; y: number }>,
    ) => true,
  );
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
    measureAlignParentBox: () => null,
    overviewScreens: [] as never,
    overviewSelectedScreenIds: [] as string[],
    rectFromCodeLayerNode,
    selectedElement: null,
    selectedLayerIdsState: selectedLayerIds,
    viewModeRef: { current: "single" as const },
    ...overrides,
  };
  return { args, commitNodePositions, handleGeometryCommit };
}

describe("alignSelectionAvailability", () => {
  it("refuses a lone top-level frame — nothing to align it against", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(availabilityArgs([fixture.frame.id])),
    ).toEqual({ canAlign: false, blocker: "no-alignable-parent" });
  });

  it("allows a single object inside a frame", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(availabilityArgs([fixture.absChild.id])),
    ).toEqual({ canAlign: true });
  });

  it("allows two top-level frames — they align to their own bounding box", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs([fixture.frame.id, fixture.unsizedParent.id]),
      ),
    ).toEqual({ canAlign: true });
  });

  it("refuses a parent whose box cannot be measured, matching the command", () => {
    const fixture = nodes();
    expect(
      alignSelectionAvailability(
        availabilityArgs([fixture.absChild.id], {
          measureAlignParentBox: () => null,
        }),
      ),
    ).toEqual({ canAlign: false, blocker: "parent-not-measurable" });
  });

  it("refuses an empty selection and a read-only design", () => {
    expect(alignSelectionAvailability(availabilityArgs([]))).toEqual({
      canAlign: false,
      blocker: "no-selection",
    });
    expect(
      alignSelectionAvailability(
        availabilityArgs([], { canEditDesign: false }),
      ),
    ).toEqual({ canAlign: false, blocker: "read-only" });
  });

  it("needs two screens in overview, where the selection is screens not layers", () => {
    expect(
      alignSelectionAvailability(
        availabilityArgs([], {
          viewMode: "overview",
          overviewSelectedScreenIds: ["file-1"],
        }),
      ),
    ).toEqual({ canAlign: false, blocker: "overview-needs-two-screens" });
    expect(
      alignSelectionAvailability(
        availabilityArgs([], {
          viewMode: "overview",
          overviewSelectedScreenIds: ["file-1", "file-2"],
        }),
      ),
    ).toEqual({ canAlign: true });
  });
});

describe("runAlignSelection", () => {
  it("writes nothing for a selection alignSelectionAvailability refuses", () => {
    const fixture = nodes();
    const { args, commitNodePositions, handleGeometryCommit } = runArgs([
      fixture.frame.id,
    ]);
    runAlignSelection(args, "left");
    expect(commitNodePositions).not.toHaveBeenCalled();
    expect(handleGeometryCommit).not.toHaveBeenCalled();
  });

  it("writes nothing when the parent box cannot be measured", () => {
    const fixture = nodes();
    const { args, commitNodePositions } = runArgs([fixture.flowChild.id]);
    runAlignSelection(args, "right");
    expect(commitNodePositions).not.toHaveBeenCalled();
  });

  it("aligns to the measured parent box, not to a zero box", () => {
    const fixture = nodes();
    const { args, commitNodePositions } = runArgs([fixture.absChild.id], {
      measureAlignParentBox: () => ({ width: 800, height: 600 }),
    });
    runAlignSelection(args, "right");
    expect(commitNodePositions.mock.calls[0]![1]).toEqual(
      new Map([[fixture.absChild.id, { x: 680, y: 250 }]]),
    );
    commitNodePositions.mockClear();
    runAlignSelection(args, "left");
    expect(commitNodePositions.mock.calls[0]![1]).toEqual(
      new Map([[fixture.absChild.id, { x: 0, y: 250 }]]),
    );
  });
});
