// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import {
  canonicalElementInfoForCodeLayerNode,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import { runCrossScreenElementDrop } from "@/pages/design-editor/commands/cross-screen-element-drop";
import { runRedo } from "@/pages/design-editor/commands/redo";
import { runUndo } from "@/pages/design-editor/commands/undo";
import {
  captureYjsUndoStackTop,
  getContentHistoryChanges,
  readYjsUndoSelection,
  stampYjsUndoSelection,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
  type GeometryHistorySelection,
} from "@/pages/design-editor/history";
import {
  captureHistorySelectionSources,
  remapHistoryChange,
  resolveHistorySelection,
} from "@/pages/design-editor/history-identity";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";

const ref = <T>(current: T) => ({ current });
const applySetter = <T>(
  target: { current: T },
  update: T | ((previous: T) => T),
) => {
  target.current =
    typeof update === "function"
      ? (update as (previous: T) => T)(target.current)
      : update;
};

function targetNode(html: string, fileId: string) {
  const node = buildCodeLayerProjection(html, {
    source: { kind: "design-file", fileId },
  }).nodes.find((candidate) => candidate.tag === "p");
  if (!node) throw new Error(`target paragraph not found for ${fileId}`);
  return node;
}

function selectionFor(fileId: string, html: string) {
  const node = targetNode(html, fileId);
  return captureHistorySelectionSources(
    {
      activeFileId: fileId,
      overviewSelectedScreenIds: [fileId],
      selectedLayerIds: [node.id],
    },
    { [fileId]: html },
  );
}

describe("history identity integration", () => {
  it("restores the selection from linked geometry replay bytes through Undo and Redo", () => {
    const fileId = "screen-replay";
    const survivorId = "screen-survivor";
    const before = "<main><p>before geometry</p></main>";
    const after = "<main><section><p>after geometry</p></section></main>";
    const staleRender = "<main><aside><p>stale render</p></aside></main>";
    const beforeSelection = selectionFor(fileId, before);
    const afterSelection = selectionFor(fileId, after);
    const change = { fileId, before, after };
    const linkedContentChanges = [change];
    const frameBefore = { x: 10, y: 20, width: 300, height: 600, z: 0 };
    const frameAfter = { x: 70, y: 80, width: 300, height: 600, z: 0 };
    const survivorFrame = { x: 400, y: 30, width: 280, height: 560, z: 1 };
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: { [fileId]: frameAfter, [survivorId]: survivorFrame },
    });
    const liveFrameGeometryRef = ref({
      [fileId]: frameAfter,
      [survivorId]: survivorFrame,
    });
    const geometryEntry = {
      before: { [fileId]: frameBefore },
      after: { [fileId]: frameAfter },
      selectionBefore: beforeSelection,
      selectionAfter: afterSelection,
      linkedContentChanges,
    };
    const geometryUndoStackRef = ref([geometryEntry]);
    const geometryRedoStackRef = ref<typeof geometryUndoStackRef.current>([]);
    const historyOrderRef = ref<Array<string>>(["geometry"]);
    const redoOrderRef = ref<Array<string>>([]);
    const appliedContentChanges = vi.fn();
    const restoreSelectionSnapshot = vi.fn();
    const selectedElementRef = ref<unknown>(null);
    const setSelectedElement = vi.fn((update: unknown) => {
      selectedElementRef.current =
        typeof update === "function"
          ? (update as (previous: unknown) => unknown)(
              selectedElementRef.current,
            )
          : update;
    });
    const writeFrameGeometrySnapshot = vi.fn(
      (geometry: Record<string, unknown>) => {
        designDataJsonRef.current = {
          ...designDataJsonRef.current,
          canvasFrames: geometry,
        };
        liveFrameGeometryRef.current =
          geometry as typeof liveFrameGeometryRef.current;
      },
    );

    const commonArgs = {
      activeEditorDragRef: ref(false),
      activeFile: { id: fileId },
      applyFileContentUpdate: vi.fn(),
      applyGeometryHistoryContentChanges: appliedContentChanges,
      applyLocalContentUpdate: vi.fn(),
      canEditDesign: true,
      clipboardPasteRedoStackRef: ref([]),
      clipboardPasteUndoStackRef: ref([]),
      codeLayerOwnerByNodeIdRef: ref(new Map()),
      contentHistorySelectionAfterRef: ref(new WeakMap()),
      contentRedoSelectionStackRef: ref([]),
      contentRedoStackRef: ref([]),
      contentUndoSelectionStackRef: ref([]),
      contentUndoStackRef: ref([]),
      designDataJsonRef,
      fileCreationRedoStackRef: ref([]),
      fileCreationUndoStackRef: ref([]),
      fileDeletionRedoStackRef: ref([]),
      fileDeletionUndoStackRef: ref([]),
      fileHistoryMutationPendingRef: ref(false),
      files: [{ id: fileId }],
      geometryRedoStackRef,
      geometryUndoStackRef,
      getFreshActiveContent: () => staleRender,
      getScreenContent: () => staleRender,
      historyOrderRef,
      id: "design",
      isSynced: true,
      lastLocalContentRef: ref(null),
      latestClipboardMutationContentRef: ref(new Map()),
      liveFrameGeometryRef,
      liveScreenSnapshotsById: {},
      localContentRedoStackRef: ref([]),
      localContentUndoStackRef: ref([]),
      markPendingLocalFileContent: vi.fn(),
      pendingLiveNonStyleEditsRef: ref([]),
      pendingLiveNonStyleRedoStackRef: ref([]),
      pendingLiveNonStyleUndoStackRef: ref([]),
      pendingLocalFileContentsRef: ref(new Map()),
      pendingVisualStyleEditsRef: ref([]),
      pendingVisualStyleRedoStackRef: ref([]),
      pendingVisualStyleUndoStackRef: ref([]),
      performDeleteFiles: vi.fn(),
      publishAuthoritativeClipboardMutation: vi.fn(() => null),
      queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
      queueFileContentSave: vi.fn(),
      redoOrderRef,
      replacePreviewContent: vi.fn(() => "applied"),
      requestPendingLiveNonStyleRevert: vi.fn(),
      requestPendingVisualStyleRevert: vi.fn(),
      restoreSelectionSnapshot,
      selectionRedoStackRef: ref([]),
      selectionUndoStackRef: ref([]),
      setActiveFileId: vi.fn(),
      setContentRenderRevision: vi.fn(),
      setHoveredElement: vi.fn(),
      setOverviewSelectedScreenIds: vi.fn(),
      setPendingLiveNonStyleEdits: vi.fn(),
      setPendingVisualStyleEdits: vi.fn(),
      setSelectedElement,
      setSelectedLayerIdsState: vi.fn(),
      suppressContentHistoryRef: ref(false),
      syncLiveScreenSnapshotPreview: vi.fn(),
      syncUndoRedoState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef: ref(null),
      updateLiveScreenSnapshotContent: vi.fn(),
      viewModeRef: ref("overview"),
      writeFrameGeometrySnapshot,
      ydoc: null,
    };

    runUndo(commonArgs as any);

    const undoTarget = targetNode(before, fileId);
    expect(selectedElementRef.current).toMatchObject({
      sourceLayerIdentity: { screenId: fileId, nodeId: undoTarget.id },
    });
    expect(selectedElementRef.current).not.toMatchObject({
      sourceLayerIdentity: {
        screenId: fileId,
        nodeId: targetNode(staleRender, fileId).id,
      },
    });
    expect(appliedContentChanges).toHaveBeenNthCalledWith(
      1,
      linkedContentChanges,
      "undo",
    );
    expect(appliedContentChanges.mock.calls[0]?.[0]).toBe(linkedContentChanges);
    expect(designDataJsonRef.current.canvasFrames).toEqual({
      [fileId]: frameBefore,
      [survivorId]: survivorFrame,
    });

    runRedo(commonArgs as any);

    const redoTarget = targetNode(after, fileId);
    expect(selectedElementRef.current).toMatchObject({
      sourceLayerIdentity: { screenId: fileId, nodeId: redoTarget.id },
    });
    expect(selectedElementRef.current).not.toMatchObject({
      sourceLayerIdentity: {
        screenId: fileId,
        nodeId: targetNode(staleRender, fileId).id,
      },
    });
    expect(appliedContentChanges).toHaveBeenNthCalledWith(
      2,
      linkedContentChanges,
      "redo",
    );
    expect(appliedContentChanges.mock.calls[1]?.[0]).toBe(linkedContentChanges);
    expect(designDataJsonRef.current.canvasFrames).toEqual({
      [fileId]: frameAfter,
      [survivorId]: survivorFrame,
    });
  });

  it("remaps a Yjs-stamped local selection from the content change bytes after the screen id changes", () => {
    const oldFileId = "screen-before-recreate";
    const restoredFileId = "screen-after-recreate";
    const before =
      '<main><div class="wrapper"><p>selected before</p></div></main>';
    const after = "<main><p>later content</p></main>";
    const originalNode = targetNode(before, oldFileId);
    const originalElement = canonicalElementInfoForCodeLayerNode(
      elementInfoFromCodeLayerNode(originalNode),
      originalNode,
      oldFileId,
    );
    const undoManager = {
      undoStack: [{ meta: new Map<unknown, unknown>() }],
    };
    const previousTop = captureYjsUndoStackTop(undoManager as any);
    undoManager.undoStack.push({ meta: new Map<unknown, unknown>() });
    stampYjsUndoSelection(undoManager as any, previousTop, {
      selectedElement: originalElement,
      selectedLayerIds: [originalNode.id],
    });

    const yjsSnapshot = readYjsUndoSelection(undoManager.undoStack[1]);
    expect(yjsSnapshot).toEqual({
      selectedElement: originalElement,
      selectedLayerIds: [originalNode.id],
    });
    expect(yjsSnapshot).not.toHaveProperty("sourceContentByFileId");
    expect(yjsSnapshot).not.toHaveProperty("sourceFileIdByFileId");

    const change = {
      fileId: oldFileId,
      before,
      after,
      selectionBefore: yjsSnapshot!,
    };
    const remapped = remapHistoryChange(
      change,
      new Map([[oldFileId, restoredFileId]]),
    );
    const expectedNode = targetNode(before, restoredFileId);

    expect(remapped.fileId).toBe(restoredFileId);
    expect(remapped.before).toBe(before);
    expect(remapped.selectionBefore?.selectedLayerIds).toEqual([
      expectedNode.id,
    ]);
    expect(remapped.selectionBefore?.selectedElement).toMatchObject({
      sourceLayerIdentity: {
        screenId: restoredFileId,
        nodeId: expectedNode.id,
      },
    });
    expect(remapped.selectionBefore?.sourceContentByFileId).toEqual({
      [restoredFileId]: before,
    });

    const resolved = resolveHistorySelection(
      {
        activeFileId: restoredFileId,
        overviewSelectedScreenIds: [],
        selectedLayerIds: remapped.selectionBefore!.selectedLayerIds,
        sourceContentByFileId: remapped.selectionBefore!.sourceContentByFileId,
        sourceFileIdByFileId: remapped.selectionBefore!.sourceFileIdByFileId,
      },
      { [restoredFileId]: before },
    );
    expect(resolved.selection?.selectedLayerIds).toEqual([expectedNode.id]);
    expect(resolved.element).toMatchObject({
      sourceLayerIdentity: {
        screenId: restoredFileId,
        nodeId: expectedNode.id,
      },
    });
  });

  it("redo restores the destination owner after a cross-screen transfer", () => {
    const sourceId = "source-screen";
    const targetId = "target-screen";
    const sourceHtml =
      '<main><button data-agent-native-node-id="widget">Widget</button></main>';
    const targetHtml =
      '<main><section data-agent-native-node-id="page"><p>Target</p></section></main>';
    const sourceNode = buildCodeLayerProjection(sourceHtml, {
      source: { kind: "design-file", fileId: sourceId },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "widget",
    );
    if (!sourceNode) throw new Error("source widget layer not found");

    const contentUndoStackRef = ref<ContentHistoryEntry[]>([]);
    const contentRedoStackRef = ref<ContentHistoryEntry[]>([]);
    const contentUndoSelectionStackRef = ref<
      (GeometryHistorySelection | undefined)[]
    >([]);
    const contentRedoSelectionStackRef = ref<
      (GeometryHistorySelection | undefined)[]
    >([]);
    const contentHistorySelectionAfterRef =
      ref<ContentHistorySelectionAfterMap>(new WeakMap());
    const historyOrderRef = ref<string[]>([]);
    const redoOrderRef = ref<string[]>([]);
    const currentContent = new Map([
      [sourceId, sourceHtml],
      [targetId, targetHtml],
    ]);
    const activeFileId = ref<string | null>(sourceId);
    const overviewSelectedScreenIds = ref([sourceId]);
    const selectedLayerIds = ref([sourceNode.id]);
    const selectedElement = ref<ElementInfo | null>(null);
    const sourceSelection = captureHistorySelectionSources(
      {
        activeFileId: sourceId,
        overviewSelectedScreenIds: [sourceId],
        selectedLayerIds: [sourceNode.id],
      },
      { [sourceId]: sourceHtml, [targetId]: targetHtml },
    );
    const applyAcceptedContent = (fileId: string, content: string) => {
      const prepared = prepareAcceptedSourceContent(content, {
        fileId,
        fileType: "html",
        previousContent: currentContent.get(fileId)!,
      });
      currentContent.set(fileId, prepared.content);
      return {
        status: "accepted" as const,
        content: prepared.content,
        nodeIdMap: prepared.nodeIdMap,
      };
    };

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: applyAcceptedContent,
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: vi.fn(),
        codeLayerOwnerByNodeIdRef: ref(new Map()),
        designSourceType: "inline",
        getScreenContent: (id) => currentContent.get(id) ?? "",
        id: "design",
        overviewScreens: [
          {
            id: targetId,
            filename: "target.html",
            content: targetHtml,
            updatedAt: "2026-09-13T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: ref(null),
        pendingOverviewScreenSelectionRef: ref(null),
        contentUndoStackRef,
        contentHistorySelectionAfterRef,
        recordContentHistoryEntry: (entry: ContentHistoryEntry) => {
          contentUndoStackRef.current.push(entry);
          contentUndoSelectionStackRef.current.push(sourceSelection);
          historyOrderRef.current.push("file-content");
          expect(
            getContentHistoryChanges(entry).map((change) => change.fileId),
          ).toEqual([sourceId, targetId]);
        },
        runtimeStructureInsertRevisionRef: ref(0),
        sendRuntimeLayerMoveSemanticHandoff: () => false,
        setActiveFileId: (value) => applySetter(activeFileId, value),
        setCreatedOverviewLayerSelection: vi.fn(),
        setOverviewSelectedScreenIds: (value) =>
          applySetter(overviewSelectedScreenIds, value),
        setRuntimeStructureInsertRequest: vi.fn(),
        setSelectedElement: (value) => applySetter(selectedElement, value),
        setSelectedLayerIdsState: (value) =>
          applySetter(selectedLayerIds, value),
        t: (key) => key,
        viewModeRef: ref("overview" as const),
      },
      {
        sourceScreenId: sourceId,
        targetScreenId: targetId,
        sourceSelector: '[data-agent-native-node-id="widget"]',
        sourceNodeId: "widget",
        sourceProvenance: {
          versionHash: createSourceDocumentProvenance(sourceHtml).versionHash,
          uniqueNodeId: "widget",
        },
        targetAnchorNodeId: "page",
        targetAnchorSelector: '[data-agent-native-node-id="page"]',
        targetAnchorPlacement: "inside",
        targetDropMode: "flow-insert",
        targetAnchorProvenance: {
          versionHash: createSourceDocumentProvenance(targetHtml).versionHash,
          uniqueNodeId: "page",
        },
      },
    );

    const targetAfterMove = currentContent.get(targetId)!;
    const movedNode = buildCodeLayerProjection(targetAfterMove, {
      source: { kind: "design-file", fileId: targetId },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "widget",
    );
    expect(movedNode).toBeDefined();
    expect(activeFileId.current).toBe(targetId);
    expect(selectedLayerIds.current).toEqual([movedNode!.id]);
    expect(selectedElement.current).toMatchObject({
      selector: expect.stringContaining('data-agent-native-node-id="widget"'),
    });

    const files = [
      { id: sourceId, filename: "source.html", fileType: "html" },
      { id: targetId, filename: "target.html", fileType: "html" },
    ];
    const restoreSelectionSnapshot = (
      selection: GeometryHistorySelection | undefined,
    ) => {
      if (!selection) return;
      activeFileId.current = selection.activeFileId ?? "";
      overviewSelectedScreenIds.current = selection.overviewSelectedScreenIds;
      selectedLayerIds.current = selection.selectedLayerIds;
    };
    const historyArgs = () =>
      ({
        activeEditorDragRef: ref(false),
        activeFile: { ...files[1], content: currentContent.get(targetId) },
        applyFileContentUpdate: (id: string, content: string) =>
          applyAcceptedContent(id, content),
        applyLocalContentUpdate: (content: string) =>
          applyAcceptedContent(targetId, content),
        canEditDesign: true,
        clipboardPasteRedoStackRef: ref([]),
        clipboardPasteUndoStackRef: ref([]),
        codeLayerOwnerByNodeIdRef: ref(new Map()),
        contentHistorySelectionAfterRef,
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        createFileMutation: { mutateAsync: vi.fn() },
        deleteFileMutation: { mutateAsync: vi.fn() },
        designDataJsonRef: ref({}),
        fileCreationRedoStackRef: ref([]),
        fileCreationUndoStackRef: ref([]),
        fileDeletionRedoStackRef: ref([]),
        fileDeletionUndoStackRef: ref([]),
        fileHistoryMutationPendingRef: ref(false),
        files,
        geometryRedoStackRef: ref([]),
        geometryUndoStackRef: ref([]),
        getFreshActiveContent: () => currentContent.get(targetId) ?? "",
        getScreenContent: (id: string) => currentContent.get(id) ?? "",
        historyOrderRef,
        id: "design",
        isSynced: true,
        lastLocalContentRef: ref(null),
        latestClipboardMutationContentRef: ref(new Map()),
        liveFrameGeometryRef: ref({}),
        liveScreenSnapshotsById: {},
        localContentRedoStackRef: ref([]),
        localContentUndoStackRef: ref([]),
        markPendingLocalFileContent: vi.fn(),
        pendingLiveNonStyleEditsRef: ref([]),
        pendingLiveNonStyleRedoStackRef: ref([]),
        pendingLiveNonStyleUndoStackRef: ref([]),
        pendingLocalFileContentsRef: ref(new Map()),
        pendingVisualStyleEditsRef: ref([]),
        pendingVisualStyleRedoStackRef: ref([]),
        pendingVisualStyleUndoStackRef: ref([]),
        performDeleteFiles: vi.fn(),
        publishAuthoritativeClipboardMutation: vi.fn(() => null),
        queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
        queueFileContentSave: vi.fn(),
        redoOrderRef,
        replacePreviewContent: vi.fn(() => "applied"),
        requestPendingLiveNonStyleRevert: vi.fn(),
        requestPendingVisualStyleRevert: vi.fn(),
        restoreSelectionSnapshot,
        selectionRedoStackRef: ref([]),
        selectionUndoStackRef: ref([]),
        setActiveFileId: (value: string) => (activeFileId.current = value),
        setContentRenderRevision: vi.fn(),
        setHoveredElement: vi.fn(),
        setOverviewSelectedScreenIds: (value: string[]) =>
          (overviewSelectedScreenIds.current = value),
        setPendingLiveNonStyleEdits: vi.fn(),
        setPendingVisualStyleEdits: vi.fn(),
        setSelectedElement: (value: ElementInfo | null) =>
          (selectedElement.current = value),
        setSelectedLayerIdsState: (value: string[]) =>
          (selectedLayerIds.current = value),
        suppressContentHistoryRef: ref(false),
        syncLiveScreenSnapshotPreview: vi.fn(),
        syncUndoRedoState: vi.fn(),
        t: (key: string) => key,
        undoManagerRef: ref(null),
        updateLiveScreenSnapshotContent: vi.fn(() => false),
        viewModeRef: ref("overview" as const),
        writeFrameGeometrySnapshot: vi.fn(),
        ydoc: null,
      }) as never;

    runUndo(historyArgs());
    expect(activeFileId.current).toBe(sourceId);
    expect(selectedElement.current).toMatchObject({
      sourceLayerIdentity: { screenId: sourceId },
    });
    expect(currentContent.get(sourceId)).toContain("Widget");
    expect(currentContent.get(targetId)).not.toContain("Widget");

    runRedo(historyArgs());
    const finalTarget = currentContent.get(targetId)!;
    const finalNode = buildCodeLayerProjection(finalTarget, {
      source: { kind: "design-file", fileId: targetId },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "widget",
    );
    expect(finalNode).toBeDefined();
    expect(activeFileId.current).toBe(targetId);
    expect(selectedLayerIds.current).toEqual([finalNode!.id]);
    expect(selectedElement.current).toMatchObject({
      sourceLayerIdentity: { screenId: targetId, nodeId: finalNode!.id },
    });
  });
});
