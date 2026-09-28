import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

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
      {
        fileId: "index.html",
        node,
        sourceProjection: projection,
        tree,
        runtimeOnly: false,
      },
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
    applyFileContentUpdate: (fileId, nextContent, options) => {
      const prepared = prepareCanonicalSourceContent(nextContent, {
        fileId,
        fileType: "html",
      });
      updateOptions = options ?? {};
      return {
        status: "accepted" as const,
        content: prepared.content,
        nodeIdMap: prepared.nodeIdMap,
      };
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
