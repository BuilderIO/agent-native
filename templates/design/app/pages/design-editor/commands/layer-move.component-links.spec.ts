import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";
// @vitest-environment happy-dom

import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

const source = {
  kind: "design-file" as const,
  designId: "design",
  fileId: "screen",
};
const content =
  '<body><main data-agent-native-node-id="main" data-agent-native-component-id="card">' +
  '<div data-agent-native-node-id="a">A</div>' +
  '<div data-agent-native-node-id="b">B</div>' +
  "</main></body>";

function fixture() {
  const projection = buildCodeLayerProjection(content, { source });
  const tree = buildCodeLayerTree(projection);
  const activeFile = {
    id: source.fileId,
    filename: "index.html",
    fileType: "html",
    content,
    createdAt: "",
    updatedAt: "",
  } as DesignFile;
  const owners = new Map(
    projection.nodes.map((node) => [
      node.id,
      {
        fileId: source.fileId,
        node,
        sourceProjection: projection,
        tree,
        runtimeOnly: false,
      },
    ]),
  );
  const a = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "a",
  )!;
  const b = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "b",
  )!;
  return { a, activeFile, b, owners };
}

describe("runLayerMove linked component routing", () => {
  it("dispatches a same-main Layers reorder before any local file write", () => {
    const { a, activeFile, b, owners } = fixture();
    const applyLinkedComponentEdit = vi.fn();
    const applyFileContentUpdate = vi.fn(() => ({
      status: "accepted" as const,
      content,
      nodeIdMap: new Map(),
    }));
    const args: LayerMoveArgs = {
      activeFileId: activeFile.id,
      activeFile,
      applyLinkedComponentEdit,
      applyFileContentUpdate,
      canEditDesign: true,
      canMoveLayer: () => true,
      codeLayerOwnerByNodeId: owners,
      effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
      files: [activeFile],
      getFreshActiveContent: () => content,
      getScreenContent: () => content,
      handleLayerMoveToScreen: vi.fn(),
      handleScreenLayerMove: vi.fn(),
      recordContentHistoryEntry: vi.fn(),
      recordLocalContentHistoryEntry: vi.fn(),
      remapMotionTracksForClone: vi.fn(),
      runtimeStructureMoveRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: vi.fn(() => false),
      setExpandedLayerIds: vi.fn(),
      setRuntimeStructureMoveRequest: vi.fn(),
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      viewModeRef: { current: "single" },
      visualScreenFileIds: new Set(),
    };

    runLayerMove(args, {
      draggedIds: [b.id],
      targetId: a.id,
      placement: "before",
    });

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(applyLinkedComponentEdit).toHaveBeenCalledExactlyOnceWith(
      source.fileId,
      "main",
      {
        kind: "structure",
        intents: [
          {
            kind: "moveNode",
            target: { nodeId: "b" },
            anchor: { nodeId: "a" },
            placement: "before",
          },
        ],
      },
    );
  });
});
