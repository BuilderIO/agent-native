import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

/**
 * Peer-reported gap: reordering two SAME-parent siblings via the Layers
 * panel persists the new order, but the bridge's non-forced replace only
 * re-morphs whichever node the CURRENT selection resolves to and returns
 * without ever touching the rest of the body (see
 * document-morph.bridge.spec.ts's "a same-parent reorder without
 * forceFullDocument" — the same write with the selection on an unrelated
 * sibling never reaches the live DOM). This pins the call-level fix: a
 * structural sibling move must ask for the whole-document (still in-place,
 * keyed) morph.
 */
const FIXTURE = `<body>
  <div data-agent-native-node-id="node-a" style="position:absolute;left:20px;top:20px;width:80px;height:80px"></div>
  <div data-agent-native-node-id="node-b" style="position:absolute;left:140px;top:20px;width:80px;height:80px"></div>
</body>`;

function buildArgs(content: string): {
  args: Omit<LayerMoveArgs, "canMoveLayer">;
  aId: string;
  bId: string;
  getUpdateOptions: () => Record<string, unknown> | null;
} {
  const projection = buildCodeLayerProjection(content);
  const tree = buildCodeLayerTree(projection);
  const codeLayerOwnerByNodeId = new Map(
    projection.nodes.map((node) => [
      node.id,
      { fileId: "index.html", node, tree, runtimeOnly: false },
    ]),
  );
  const aId = projection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === "node-a",
  )!.id;
  const bId = projection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === "node-b",
  )!.id;

  const activeFile: DesignFile = {
    id: "index.html",
    filename: "index.html",
    fileType: "html",
    content,
    createdAt: "",
    updatedAt: "",
  };

  let updateOptions: Record<string, unknown> | null = null;

  const args: Omit<LayerMoveArgs, "canMoveLayer"> = {
    activeFile,
    applyFileContentUpdate: (_fileId, _nextContent, options) => {
      updateOptions = options ?? {};
    },
    canEditDesign: true,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
    files: [activeFile],
    getFreshActiveContent: () => content,
    getScreenContent: () => content,
    handleLayerMoveToScreen: () => {},
    handleScreenLayerMove: () => {},
    recordContentHistoryEntry: () => {},
    recordLocalContentHistoryEntry: () => {},
    remapMotionTracksForClone: () => {},
    runtimeStructureMoveRevisionRef: { current: 0 },
    sendRuntimeLayerMoveSemanticHandoff: () => false,
    setExpandedLayerIds: () => {},
    setRuntimeStructureMoveRequest: () => {},
    setSelectedElement: () => {},
    setSelectedLayerIdsState: () => {},
    t: (key: string) => key,
    viewModeRef: { current: "single" },
    visualScreenFileIds: new Set(),
  };
  return { args, aId, bId, getUpdateOptions: () => updateOptions };
}

describe("runLayerMove: preview scope on a same-file sibling reorder", () => {
  it("forces a whole-document preview replace so the reordered sibling reaches the live iframe", () => {
    const { args, aId, bId, getUpdateOptions } = buildArgs(FIXTURE);
    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [bId],
      targetId: aId,
      placement: "before",
    });

    const options = getUpdateOptions();
    expect(
      options,
      "runLayerMove did not persist any content update",
    ).not.toBeNull();
    expect(
      options!.forcePreviewFullDocument,
      "a structural sibling reorder must force the whole-document morph — the scoped, selection-only replace never reaches a sibling outside the current selection's subtree",
    ).toBe(true);
  });
});
