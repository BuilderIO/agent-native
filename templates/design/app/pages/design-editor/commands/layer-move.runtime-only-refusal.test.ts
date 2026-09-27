import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { toast } from "sonner";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

const CONTENT = `<body>
  <div data-agent-native-node-id="regular" style="position:relative">Regular</div>
  <div data-agent-native-node-id="target" style="position:relative"></div>
</body>`;

function buildArgs() {
  const projection = buildCodeLayerProjection(CONTENT);
  const tree = buildCodeLayerTree(projection);
  const regularNode = projection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === "regular",
  )!;
  const targetNode = projection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === "target",
  )!;
  const runtimeOnlyId = "runtime-fake-clone-id";
  const codeLayerOwnerByNodeId = new Map([
    [
      regularNode.id,
      {
        fileId: "index.html",
        node: regularNode,
        sourceProjection: projection,
        tree,
        runtimeOnly: false,
      },
    ],
    [
      targetNode.id,
      {
        fileId: "index.html",
        node: targetNode,
        sourceProjection: projection,
        tree,
        runtimeOnly: false,
      },
    ],
    [
      runtimeOnlyId,
      {
        fileId: "index.html",
        node: regularNode,
        sourceProjection: projection,
        tree,
        runtimeOnly: true,
      },
    ],
  ]);

  const activeFile: DesignFile = {
    id: "index.html",
    filename: "index.html",
    fileType: "html",
    content: CONTENT,
    createdAt: "",
    updatedAt: "",
  };

  let applyCalled = false;
  const args: LayerMoveArgs = {
    activeFile,
    applyFileContentUpdate: (fileId, nextContent) => {
      applyCalled = true;
      const prepared = prepareCanonicalSourceContent(nextContent, {
        fileId,
        fileType: "html",
      });
      return {
        status: "accepted" as const,
        content: prepared.content,
        nodeIdMap: prepared.nodeIdMap,
      };
    },
    canEditDesign: true,
    canMoveLayer: () => true,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
    files: [activeFile],
    getFreshActiveContent: () => CONTENT,
    getScreenContent: () => CONTENT,
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
  return {
    args,
    regularNode,
    targetNode,
    runtimeOnlyId,
    isApplied: () => applyCalled,
  };
}

describe("runLayerMove: runtime-only id in a multi-select drag", () => {
  it("refuses with plain-language copy instead of a raw node-id error, and still moves the regular item", () => {
    const { args, regularNode, targetNode, runtimeOnlyId, isApplied } =
      buildArgs();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();

    runLayerMove(args, {
      draggedIds: [runtimeOnlyId, regularNode.id],
      targetId: targetNode.id,
      placement: "inside",
    });

    const calls = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
    for (const [message] of calls) {
      expect(message).not.toMatch(/not found in sourceHtml/i);
      expect(message).not.toMatch(/No code layer node exists/i);
      expect(message).not.toMatch(runtimeOnlyId);
    }
    expect(isApplied(), "the non-runtime dragged item should still move").toBe(
      true,
    );
  });
});
