// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import {
  readYjsRedoSelection,
  readYjsUndoSelection,
  YJS_UNDO_SELECTION_META_KEY,
} from "@/pages/design-editor/history";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runDuplicateSelection } from "./duplicate-selection";

describe("runDuplicateSelection selection tracking", () => {
  it("duplicates the selected overview screen when it differs from activeFile", () => {
    const activeFile: DesignFile = {
      id: "first-copy",
      filename: "index-copy.html",
      fileType: "html",
      content: "<main>first copy</main>",
      createdAt: "",
      updatedAt: "",
    };
    const duplicateScreen = vi.fn();

    runDuplicateSelection({
      activeFile,
      designId: "design",
      applyFileContentUpdate: vi.fn(),
      applyLocalContentUpdate: vi.fn(),
      canEditDesign: true,
      files: [activeFile],
      getFreshActiveContent: () => activeFile.content,
      getScreenContent: () => activeFile.content,
      getSelectedLayerSnapshots: () => [],
      handleDuplicateScreen: duplicateScreen,
      lastDuplicateTransformRef: { current: null },
      overviewSelectedScreenIds: ["source"],
      remapMotionTracksForClone: vi.fn(),
      selectedCanvasSelector: "",
      selectedElement: null,
      selectedLayerIdsState: [],
      setOverviewSelectedScreenIds: vi.fn(),
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key) => key,
      undoManagerRef: { current: null },
      viewModeRef: { current: "overview" },
    });

    expect(duplicateScreen).toHaveBeenCalledExactlyOnceWith(
      "source",
      expect.objectContaining({
        historyBatchId: expect.any(String),
        duplicateStackSourceIds: ["source"],
      }),
    );
  });

  it("duplicates a multi-screen overview selection as one history batch", () => {
    const duplicateScreen = vi.fn();
    const first: DesignFile = {
      id: "first",
      filename: "first.html",
      fileType: "html",
      content: "<main>first</main>",
      createdAt: "",
      updatedAt: "",
    };
    const second: DesignFile = {
      id: "second",
      filename: "second.html",
      fileType: "html",
      content: "<main>second</main>",
      createdAt: "",
      updatedAt: "",
    };

    runDuplicateSelection({
      activeFile: first,
      designId: "design",
      applyFileContentUpdate: vi.fn(),
      applyLocalContentUpdate: vi.fn(),
      canEditDesign: true,
      files: [first, second],
      getFreshActiveContent: () => first.content,
      getScreenContent: (screenId) =>
        screenId === second.id ? second.content : first.content,
      getSelectedLayerSnapshots: () => [],
      handleDuplicateScreen: duplicateScreen,
      lastDuplicateTransformRef: { current: null },
      overviewSelectedScreenIds: [first.id, second.id],
      remapMotionTracksForClone: vi.fn(),
      selectedCanvasSelector: "",
      selectedElement: null,
      selectedLayerIdsState: [],
      setOverviewSelectedScreenIds: vi.fn(),
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key) => key,
      undoManagerRef: { current: null },
      viewModeRef: { current: "overview" },
    });

    expect(duplicateScreen).toHaveBeenCalledTimes(2);
    const requests = duplicateScreen.mock.calls.map(([, request]) => request);
    expect(requests[0]?.historyBatchId).toEqual(expect.any(String));
    expect(requests[1]?.historyBatchId).toBe(requests[0]?.historyBatchId);
    expect(requests[0]?.duplicateStackSourceIds).toEqual(["first", "second"]);
    expect(requests[1]?.duplicateStackSourceIds).toEqual(["first", "second"]);
  });

  it("selects the newly inserted copy, not the pre-duplication original", () => {
    const designId = "design-title";
    const fileId = "screen-title";
    const source = {
      kind: "design-file" as const,
      designId,
      fileId,
      filename: "index.html",
    };
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="title" data-agent-native-layer-name="Project title" style="position:absolute;left:40px;top:40px">Portfolio Project</div>
    </body></html>`;
    const projection = buildCodeLayerProjection(content, { source });
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "title",
    );
    expect(node?.source).toBeTruthy();
    if (!node?.source) return;

    const snapshot = {
      html: content.slice(node.source.start, node.source.end),
      rootNodeId: "title",
      sourceFileId: fileId,
      node,
      sourceIndex: 0,
      tree: buildCodeLayerTree(projection),
    };
    let currentContent = content;
    const file: DesignFile = {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "",
      updatedAt: "",
    };
    const acceptedUpdate = (nextContent: string) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId,
        fileType: "html",
      });
      currentContent = publication.content;
      return {
        status: "accepted" as const,
        content: publication.content,
        nodeIdMap: publication.nodeIdMap,
      };
    };
    const setSelectedLayerIdsState = vi.fn();
    const clearExplicitOverviewScreenSelection = vi.fn();

    runDuplicateSelection({
      activeFile: file,
      designId,
      clearExplicitOverviewScreenSelection,
      applyFileContentUpdate: (_targetFileId, nextContent) =>
        acceptedUpdate(nextContent),
      applyLocalContentUpdate: (nextContent) => acceptedUpdate(nextContent),
      canEditDesign: true,
      files: [file],
      getFreshActiveContent: () => currentContent,
      getScreenContent: () => currentContent,
      getSelectedLayerSnapshots: () => [snapshot],
      handleDuplicateScreen: () => {},
      lastDuplicateTransformRef: { current: null },
      overviewSelectedScreenIds: [fileId],
      remapMotionTracksForClone: () => {},
      selectedCanvasSelector: node.selector,
      selectedElement: null,
      selectedLayerIdsState: ["title"],
      setOverviewSelectedScreenIds: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState,
      t: (key) => key,
      undoManagerRef: { current: null },
      viewModeRef: { current: "single" },
    });

    const after = buildCodeLayerProjection(currentContent, { source });
    const originalNode = after.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "title",
    );
    const copyNode = after.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-layer-name"] ===
          "Project title" && candidate.id !== originalNode?.id,
    );
    expect(copyNode, "duplicate did not produce a second node").toBeTruthy();

    expect(setSelectedLayerIdsState).toHaveBeenCalledWith([copyNode!.id]);
    expect(setSelectedLayerIdsState).not.toHaveBeenCalledWith([
      originalNode!.id,
    ]);
    expect(clearExplicitOverviewScreenSelection).toHaveBeenCalledOnce();
  });

  it("stamps undo and redo selection for a duplicated layer in Yjs and local fallback history", () => {
    const designId = "design-duplicate-history";
    const fileId = "screen-duplicate-history";
    const source = {
      kind: "design-file" as const,
      designId,
      fileId,
      filename: "index.html",
    };
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="title" data-agent-native-layer-name="Project title" style="position:absolute;left:40px;top:40px">Portfolio Project</div>
    </body></html>`;
    const projection = buildCodeLayerProjection(content, { source });
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "title",
    );
    expect(node).toBeDefined();
    if (!node) return;

    const originalSelection = {
      selectedElement: elementInfoFromCodeLayerNode(node),
      selectedLayerIds: [node.id],
    };
    const previousYjsItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: {
        undoStack: [previousYjsItem],
        stopCapturing: vi.fn(),
      },
    };
    const localUndoStackRef = { current: [] as any[] };
    let currentContent = content;
    const file: DesignFile = {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "",
      updatedAt: "",
    };
    const snapshot = {
      html: content.slice(node.source!.start, node.source!.end),
      rootNodeId: "title",
      sourceFileId: fileId,
      node,
      sourceIndex: 0,
      tree: buildCodeLayerTree(projection),
    };
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();
    const selectionBefore = {
      overviewSelectedScreenIds: [],
      selectedLayerIds: [node.id],
      activeFileId: fileId,
    };

    runDuplicateSelection({
      activeFile: file,
      designId,
      applyFileContentUpdate: (_targetFileId, nextContent, options) => {
        const publication = prepareCanonicalSourceContent(nextContent, {
          fileId,
          fileType: "html",
        });
        currentContent = publication.content;
        undoManagerRef.current.undoStack.push({ meta: new Map() });
        localUndoStackRef.current.push({
          fileId,
          before: content,
          after: publication.content,
          selectionBefore: options?.selectionBefore,
        });
        return {
          status: "accepted",
          content: publication.content,
          nodeIdMap: publication.nodeIdMap,
          yjsHistoryRecorded: true,
        };
      },
      applyLocalContentUpdate: vi.fn(),
      canEditDesign: true,
      files: [file],
      getFreshActiveContent: () => currentContent,
      getScreenContent: () => currentContent,
      getSelectedLayerSnapshots: () => [snapshot],
      handleDuplicateScreen: vi.fn(),
      lastDuplicateTransformRef: { current: null },
      localContentUndoStackRef: localUndoStackRef,
      overviewSelectedScreenIds: [],
      remapMotionTracksForClone: vi.fn(),
      selectionBefore,
      selectedCanvasSelector: node.selector,
      selectedElement: originalSelection.selectedElement,
      selectedLayerIdsState: [node.id],
      setOverviewSelectedScreenIds: vi.fn(),
      setSelectedElement,
      setSelectedLayerIdsState,
      t: (key) => key,
      undoManagerRef: undoManagerRef as any,
      viewModeRef: { current: "single" },
    });

    const after = buildCodeLayerProjection(currentContent, { source });
    const copyNode = after.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-layer-name"] ===
          "Project title" && candidate.id !== node.id,
    );
    expect(copyNode).toBeDefined();
    if (!copyNode) return;
    const selectedElement = elementInfoFromCodeLayerNode(copyNode);
    const selectedLayerIds = [copyNode.id];
    const yjsItem = undoManagerRef.current.undoStack[1]!;

    expect(readYjsUndoSelection(yjsItem)).toEqual(originalSelection);
    expect(readYjsRedoSelection(yjsItem)).toMatchObject({
      selectedElement,
      selectedLayerIds,
    });
    expect(localUndoStackRef.current[0]).toMatchObject({
      selectionBefore: originalSelection,
      selectionAfter: { selectedElement, selectedLayerIds },
    });
    expect(setSelectedElement).toHaveBeenCalledWith(selectedElement);
    expect(setSelectedLayerIdsState).toHaveBeenCalledWith(selectedLayerIds);
    expect(
      previousYjsItem.meta.get(YJS_UNDO_SELECTION_META_KEY),
    ).toBeUndefined();
  });
});
