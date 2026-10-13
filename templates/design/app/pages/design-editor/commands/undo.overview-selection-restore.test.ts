import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { runUndo } from "@/pages/design-editor/commands/undo";

const CONTENT_WITH_BOX_A = `<!doctype html><html><body>
<div data-agent-native-node-id="box-a" style="position:absolute;left:10px;top:10px;width:20px;height:20px"></div>
</body></html>`;
const CONTENT_WITHOUT_BOX_A = `<!doctype html><html><body></body></html>`;

function boxANodeId(): string {
  const node = buildCodeLayerProjection(CONTENT_WITH_BOX_A, {
    source: { kind: "design-file", fileId: "file-1" },
  }).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === "box-a",
  );
  if (!node) throw new Error("fixture node not found");
  return node.id;
}

function overviewArgs(overrides: Record<string, unknown> = {}) {
  return {
    activeEditorDragRef: { current: false },
    activeFile: { id: "file-1" },
    applyFileContentUpdate: vi.fn((fileId: string, content: string) => ({
      status: "accepted" as const,
      content,
      nodeIdMap: new Map(),
    })),
    applyLocalContentUpdate: vi.fn((content: string) => ({
      status: "accepted" as const,
      content,
      nodeIdMap: new Map(),
    })),
    canEditDesign: true,
    clipboardPasteRedoStackRef: { current: [] },
    clipboardPasteUndoStackRef: { current: [] },
    contentRedoSelectionStackRef: { current: [] },
    contentRedoStackRef: { current: [] },
    contentHistorySelectionAfterRef: { current: new WeakMap() },
    contentUndoSelectionStackRef: { current: [] },
    contentUndoStackRef: { current: [] },
    designDataJsonRef: { current: {} },
    fileHistoryMutationPendingRef: { current: false },
    files: [{ id: "file-1" }],
    geometryRedoStackRef: { current: [] },
    geometryUndoStackRef: { current: [] },
    getFreshActiveContent: () => CONTENT_WITHOUT_BOX_A,
    getScreenContent: () => "",
    historyOrderRef: { current: [] },
    id: "design-1",
    isSynced: true,
    lastLocalContentRef: { current: null },
    latestClipboardMutationContentRef: { current: new Map() },
    liveFrameGeometryRef: { current: {} },
    liveScreenSnapshotsById: {},
    localContentRedoStackRef: { current: [] },
    localContentUndoStackRef: { current: [] },
    markPendingLocalFileContent: vi.fn(),
    pendingLiveNonStyleEditsRef: { current: [] },
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingLocalFileContentsRef: { current: new Map() },
    pendingVisualStyleEditsRef: { current: [] },
    pendingVisualStyleRedoStackRef: { current: [] },
    pendingVisualStyleUndoStackRef: { current: [] },
    queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
    queueFileContentSave: vi.fn(),
    redoOrderRef: { current: [] },
    replacePreviewContent: vi.fn(() => "applied"),
    requestPendingLiveNonStyleRevert: vi.fn(),
    requestPendingVisualStyleRevert: vi.fn(),
    restoreSelectionSnapshot: vi.fn(),
    setActiveFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    setHoveredElement: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setPendingLiveNonStyleEdits: vi.fn(),
    setPendingVisualStyleEdits: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    suppressContentHistoryRef: { current: false },
    syncLiveScreenSnapshotPreview: vi.fn(),
    syncUndoRedoState: vi.fn(),
    t: (key: string) => key,
    undoManagerRef: { current: null },
    updateLiveScreenSnapshotContent: vi.fn(),
    viewModeRef: { current: "overview" as const },
    writeFrameGeometrySnapshot: vi.fn(),
    ydoc: null,
    ...overrides,
  } as unknown as Parameters<typeof runUndo>[0];
}

describe("runUndo — overview content-undo restores an ElementInfo, not just the layer id", () => {
  it("derives selectedElement from the restored content + captured layer id", () => {
    const nodeId = boxANodeId();
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();

    runUndo(
      overviewArgs({
        historyOrderRef: { current: ["file-content"] },
        contentUndoStackRef: {
          current: [
            {
              fileId: "file-1",
              before: CONTENT_WITH_BOX_A,
              after: CONTENT_WITHOUT_BOX_A,
            },
          ],
        },
        contentUndoSelectionStackRef: {
          current: [
            {
              overviewSelectedScreenIds: [],
              selectedLayerIds: [nodeId],
              activeFileId: "file-1",
            },
          ],
        },
        setSelectedElement,
        setSelectedLayerIdsState,
      }),
    );

    const directRestoreCall = setSelectedElement.mock.calls.find(
      ([arg]) => typeof arg !== "function",
    );
    expect(directRestoreCall).toBeDefined();
    const restored = directRestoreCall![0];
    expect(restored).toMatchObject({
      sourceLayerIdentity: { screenId: "file-1", nodeId },
    });
  });

  it("does not touch selectedElement when nothing was selected for the entry", () => {
    const setSelectedElement = vi.fn();

    runUndo(
      overviewArgs({
        historyOrderRef: { current: ["file-content"] },
        contentUndoStackRef: {
          current: [
            {
              fileId: "file-1",
              before: CONTENT_WITH_BOX_A,
              after: CONTENT_WITHOUT_BOX_A,
            },
          ],
        },
        contentUndoSelectionStackRef: { current: [undefined] },
        setSelectedElement,
      }),
    );

    expect(
      setSelectedElement.mock.calls.every(([arg]) => typeof arg === "function"),
    ).toBe(true);
  });
});
