// @vitest-environment happy-dom
//
// duplicateNodeForPanelDrop now clones through prepareClonedHtmlLayer (see
// clone-and-pen-edit.ts), which needs a real `document` to build the clone
// through — the default node test environment has none.
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { analyzeComponentLinks } from "@shared/component-links";
import { COMPONENT_REF_ATTR } from "@shared/component-model";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { toast } from "sonner";

import type {
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
} from "@/pages/design-editor/history";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  duplicateNodeForPanelDrop,
  runLayerMove,
  type LayerMoveArgs,
} from "./layer-move";

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

    expect(content.match(/data-agent-native-node-id="alpha"/g)).toHaveLength(1);
    expect(content.match(/data-agent-native-node-id="beta"/g)).toHaveLength(1);
    expect(
      content.match(/data-agent-native-layer-name="Alpha Button"/g),
    ).toHaveLength(2);
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
        {
          fileId: "index.html",
          node,
          sourceProjection: projection,
          tree,
          runtimeOnly: false,
        },
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

describe("runLayerMove: accepted duplicate selection history", () => {
  it("stamps the accepted clone as the redo selection", () => {
    const content = `<body>
      <div data-agent-native-node-id="alpha">Alpha</div>
      <div data-agent-native-node-id="target">Target</div>
    </body>`;
    const fileId = "index.html";
    const source = { kind: "design-file" as const, fileId };
    const projection = buildCodeLayerProjection(content, { source });
    const tree = buildCodeLayerTree(projection);
    const nodeId = (authoredId: string) =>
      projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === authoredId,
      )!.id;
    const activeFile: DesignFile = {
      id: fileId,
      filename: fileId,
      fileType: "html",
      content,
      createdAt: "",
      updatedAt: "",
    };
    const contentUndoStackRef = { current: [] as ContentHistoryEntry[] };
    const contentHistorySelectionAfterRef = {
      current: new WeakMap() as ContentHistorySelectionAfterMap,
    };
    const selectedIds: string[][] = [];
    const codeLayerOwnerByNodeId = new Map(
      projection.nodes.map((node) => [
        node.id,
        {
          fileId,
          node,
          sourceProjection: projection,
          tree,
          runtimeOnly: false,
        },
      ]),
    );
    const applyFileContentUpdate: LayerMoveArgs["applyFileContentUpdate"] = (
      targetFileId,
      nextContent,
      options,
    ) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId: targetFileId,
        fileType: "html",
      });
      if (options?.recordHistory !== false) {
        contentUndoStackRef.current.push({
          fileId: targetFileId,
          before: content,
          after: publication.content,
        });
      }
      return {
        status: "accepted",
        content: publication.content,
        nodeIdMap: publication.nodeIdMap,
      };
    };

    runLayerMove(
      {
        activeFile,
        activeFileId: fileId,
        applyFileContentUpdate,
        canEditDesign: true,
        canMoveLayer: () => true,
        codeLayerOwnerByNodeId,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
        files: [activeFile],
        getFreshActiveContent: () => content,
        getScreenContent: () => content,
        handleLayerMoveToScreen: () => {},
        handleScreenLayerMove: () => {},
        overviewSelectedScreenIds: [fileId],
        recordContentHistoryEntry: (entry) => {
          contentUndoStackRef.current.push(entry);
        },
        recordLocalContentHistoryEntry: () => {},
        remapMotionTracksForClone: () => {},
        runtimeStructureMoveRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff: () => false,
        setExpandedLayerIds: () => {},
        setRuntimeStructureMoveRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: (ids) =>
          selectedIds.push(typeof ids === "function" ? ids([]) : ids),
        t: (key) => key,
        viewModeRef: { current: "overview" },
        visualScreenFileIds: new Set(),
      },
      {
        draggedIds: [nodeId("alpha")],
        targetId: nodeId("target"),
        placement: "after",
        duplicate: true,
      },
    );

    expect(contentUndoStackRef.current).toHaveLength(1);
    expect(selectedIds).toHaveLength(1);
    const entry = contentUndoStackRef.current[0]!;
    const after = contentHistorySelectionAfterRef.current.get(entry);
    expect(after?.selectedLayerIds).toEqual(selectedIds[0]);
    expect(after?.sourceContentByFileId?.[fileId]).toBe(
      (entry as { after: string }).after,
    );
  });

  it("links an Alt-drag duplicate using the owning Design source projection", () => {
    const designId = "design-1";
    const fileId = "screen-1";
    const content = `<!doctype html><html><body>
      <button data-agent-native-node-id="card-main" data-agent-native-component-id="cmp-card" data-agent-native-component="Card">Card</button>
      <div data-agent-native-node-id="drop-target">Target</div>
    </body></html>`;
    const source = {
      kind: "design-file" as const,
      designId,
      fileId,
      filename: "index.html",
    };
    const projection = buildCodeLayerProjection(content, { source });
    const tree = buildCodeLayerTree(projection);
    const nodeId = (authoredId: string) =>
      projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === authoredId,
      )!.id;
    const file: DesignFile = {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "",
      updatedAt: "",
    };
    const codeLayerOwnerByNodeId = new Map(
      projection.nodes.map((node) => [
        node.id,
        {
          fileId,
          node,
          sourceProjection: projection,
          tree,
          runtimeOnly: false,
        },
      ]),
    );
    let acceptedContent = content;
    const applyFileContentUpdate: LayerMoveArgs["applyFileContentUpdate"] = (
      targetFileId,
      nextContent,
    ) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId: targetFileId,
        fileType: "html",
      });
      acceptedContent = publication.content;
      return {
        status: "accepted",
        content: publication.content,
        nodeIdMap: publication.nodeIdMap,
      };
    };

    runLayerMove(
      {
        activeFile: file,
        activeFileId: fileId,
        applyFileContentUpdate,
        canEditDesign: true,
        canMoveLayer: () => true,
        codeLayerOwnerByNodeId,
        effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
        files: [file],
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
        t: (key) => key,
        viewModeRef: { current: "overview" },
        visualScreenFileIds: new Set(),
      },
      {
        draggedIds: [nodeId("card-main")],
        targetId: nodeId("drop-target"),
        placement: "after",
        duplicate: true,
      },
    );

    const result = buildCodeLayerProjection(acceptedContent, { source });
    expect(
      result.nodes.filter(
        (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
      ),
    ).toHaveLength(1);
    expect(
      analyzeComponentLinks([result]).components.find(
        (component) => component.componentId === "cmp-card",
      )?.status,
    ).toBe("resolved");
  });
});
