// @vitest-environment happy-dom
//
// duplicateNodeForPanelDrop now clones through prepareClonedHtmlLayer (see
// clone-and-pen-edit.ts), which needs a real `document` to build the clone
// through — the default node test environment has none.
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { toast } from "sonner";

import type { DesignFile } from "@/pages/design-editor/types";

import {
  duplicateNodeForPanelDrop,
  runLayerMove,
  type LayerMoveArgs,
} from "./layer-move";

/**
 * unique-paths-1: Alt-drag inside the Layers panel must duplicate the
 * dragged layer at the drop position and leave the original untouched —
 * before this fix, LayersPanel.tsx's handleDrop had no altKey branch at
 * all, so the drag only ever reordered/reparented the original node.
 */
describe("duplicateNodeForPanelDrop", () => {
  const html = `<!doctype html><html><body>
    <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha Button">Alpha</div>
    <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta Button">Beta</div>
  </body></html>`;

  function idOf(content: string, name: string): string {
    const projection = buildCodeLayerProjection(content);
    return projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === name,
    )!.id;
  }

  it("clones the dragged node next to the target and keeps the original", () => {
    const alphaId = idOf(html, "alpha");
    const betaId = idOf(html, "beta");

    const result = duplicateNodeForPanelDrop(html, alphaId, betaId, "after");
    expect(result).not.toBeNull();

    const { content, duplicatedNodeId } = result!;
    expect(duplicatedNodeId).not.toBe("alpha");

    // The original must survive unchanged — exactly one "alpha" and one
    // "beta" node id, plus the fresh clone.
    expect(content.match(/data-agent-native-node-id="alpha"/g)).toHaveLength(1);
    expect(content.match(/data-agent-native-node-id="beta"/g)).toHaveLength(1);
    const projection = buildCodeLayerProjection(content);
    const clone = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === duplicatedNodeId,
    );
    expect(clone).toBeTruthy();
    expect(clone!.layerName).toBe("Alpha Button");
  });

  it("returns null when the dragged node id isn't in the document", () => {
    const betaId = idOf(html, "beta");
    expect(
      duplicateNodeForPanelDrop(html, "not-a-real-id", betaId, "after"),
    ).toBeNull();
  });

  it("re-keys an authored id attribute on the clone and reports it in nodeIdMap", () => {
    const authoredHtml = `<!doctype html><html><body>
      <div id="card" data-agent-native-node-id="alpha" data-agent-native-layer-name="Card">Alpha</div>
      <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta Button">Beta</div>
    </body></html>`;
    const alphaId = idOf(authoredHtml, "alpha");
    const betaId = idOf(authoredHtml, "beta");

    const result = duplicateNodeForPanelDrop(
      authoredHtml,
      alphaId,
      betaId,
      "after",
    );
    expect(result).not.toBeNull();
    const { content, nodeIdMap } = result!;

    // The authored id must not be duplicated in the DOM.
    expect(content.match(/id="card"/g)).toHaveLength(1);
    expect(nodeIdMap.get("alpha")).toBeTruthy();
    expect(nodeIdMap.get("alpha")).not.toBe("alpha");
  });

  it("carries a motion track on the clone via the reported nodeIdMap", () => {
    const alphaId = idOf(html, "alpha");
    const betaId = idOf(html, "beta");

    const result = duplicateNodeForPanelDrop(html, alphaId, betaId, "after");
    expect(result).not.toBeNull();
    const { nodeIdMap, duplicatedNodeId } = result!;

    // Mirrors DesignEditor.tsx's remapMotionTracksForClone: a track keyed
    // to the original node id gets a cloned entry retargeted to the copy.
    const motionTracks = [{ targetNodeId: "alpha", property: "opacity" }];
    const remapped = motionTracks
      .filter((track) => nodeIdMap.has(track.targetNodeId))
      .map((track) => ({
        ...track,
        targetNodeId: nodeIdMap.get(track.targetNodeId)!,
      }));
    expect(remapped).toEqual([
      { targetNodeId: duplicatedNodeId, property: "opacity" },
    ]);
  });
});

/**
 * unique-paths-2: an Alt-drag duplicate that cannot be honoured (multi-
 * selection, cross-file, runtime-only, or a locked source) must refuse
 * instead of silently falling through to a destructive move of the
 * original.
 */
describe("runLayerMove: duplicate intent that can't be honoured", () => {
  const CONTENT = `<body>
    <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha">Alpha</div>
    <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta">Beta</div>
    <div data-agent-native-node-id="target"></div>
  </body>`;

  function buildArgs() {
    const projection = buildCodeLayerProjection(CONTENT);
    const tree = buildCodeLayerTree(projection);
    const codeLayerOwnerByNodeId = new Map(
      projection.nodes.map((node) => [
        node.id,
        { fileId: "index.html", node, tree, runtimeOnly: false },
      ]),
    );
    const nodeId = (authoredId: string) =>
      projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === authoredId,
      )!.id;
    const activeFile: DesignFile = {
      id: "index.html",
      filename: "index.html",
      fileType: "html",
      content: CONTENT,
      createdAt: "",
      updatedAt: "",
    };
    const applyFileContentUpdate = vi.fn();
    const args: LayerMoveArgs = {
      activeFile,
      applyFileContentUpdate,
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
    return { args, nodeId, applyFileContentUpdate };
  }

  it("refuses a multi-selection duplicate drop without moving the originals", () => {
    const { args, nodeId, applyFileContentUpdate } = buildArgs();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();

    runLayerMove(args, {
      draggedIds: [nodeId("alpha"), nodeId("beta")],
      targetId: nodeId("target"),
      placement: "inside",
      duplicate: true,
    });

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("refuses (rather than moves) when the single-node fast path can't apply, e.g. a locked source", () => {
    const { args, nodeId, applyFileContentUpdate } = buildArgs();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    const lockedArgs: LayerMoveArgs = {
      ...args,
      effectiveCodeLayerState: {
        lockedIds: new Set([nodeId("alpha")]),
        hiddenIds: new Set(),
      },
    };

    runLayerMove(lockedArgs, {
      draggedIds: [nodeId("alpha")],
      targetId: nodeId("target"),
      placement: "inside",
      duplicate: true,
    });

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
