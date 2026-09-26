import { buildCodeLayerProjection } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  canonicalElementInfoForCodeLayerNode,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import { writeCollabText } from "@/pages/design-editor/collab-sync";
import { runRedo } from "@/pages/design-editor/commands/redo";
import { runUndo } from "@/pages/design-editor/commands/undo";
import { LOCAL_EDIT_ORIGIN } from "@/pages/design-editor/editor-session";
import { YJS_UNDO_SELECTION_META_KEY } from "@/pages/design-editor/history";

const CONTENT_WITH_BOX_A = `<!doctype html><html data-agent-native-node-id="html-1"><body data-agent-native-node-id="body-1">
<div data-agent-native-node-id="box-a" style="position:absolute;left:10px;top:10px;width:20px;height:20px"></div>
</body></html>`;
const CONTENT_WITHOUT_BOX_A = `<!doctype html><html data-agent-native-node-id="html-1"><body data-agent-native-node-id="body-1"></body></html>`;

function sourceBoxA() {
  const projection = buildCodeLayerProjection(CONTENT_WITH_BOX_A, {
    source: { kind: "design-file", fileId: "file-1" },
  });
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === "box-a",
  );
  if (!node) throw new Error("source projection fixture node not found");
  return {
    node,
    element: canonicalElementInfoForCodeLayerNode(
      elementInfoFromCodeLayerNode(node),
      node,
      "file-1",
    ),
  };
}

function baseArgs(overrides: Record<string, unknown> = {}) {
  const refreshCalls: string[] = [];
  const undoManagerRef = { current: overrides.um ?? null };
  return {
    activeEditorDragRef: { current: false },
    activeFile: { id: "file-1", updatedAt: "2024-01-01T00:00:00Z" },
    applyFileContentUpdate: vi.fn(),
    applyLocalContentUpdate: vi.fn(),
    canEditDesign: true,
    clipboardPasteRedoStackRef: { current: [] },
    clipboardPasteUndoStackRef: { current: [] },
    contentRedoSelectionStackRef: { current: [] },
    contentRedoStackRef: { current: [] },
    contentUndoSelectionStackRef: { current: [] },
    contentUndoStackRef: { current: [] },
    designDataJsonRef: { current: {} },
    fileHistoryMutationPendingRef: { current: false },
    files: [],
    geometryRedoStackRef: { current: [] },
    geometryUndoStackRef: { current: [] },
    getFreshActiveContent: () => "next-content",
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
    setSelectedElement: vi.fn((updater: unknown) => {
      refreshCalls.push(
        `selectedElement:${typeof updater === "function" ? (updater as (p: unknown) => unknown)(null) : updater}`,
      );
    }),
    setSelectedLayerIdsState: vi.fn(),
    suppressContentHistoryRef: { current: false },
    syncLiveScreenSnapshotPreview: vi.fn(),
    syncUndoRedoState: vi.fn(),
    t: (key: string) => key,
    undoManagerRef,
    updateLiveScreenSnapshotContent: vi.fn(),
    viewModeRef: { current: "single" as const },
    writeFrameGeometrySnapshot: vi.fn(),
    ydoc: { getText: () => ({ toJSON: () => "next-content" }) },
    ...overrides,
  } as unknown as Parameters<typeof runUndo>[0];
}

function fakeStackItem(meta?: Record<string, unknown>) {
  const map = new Map<unknown, unknown>(Object.entries(meta ?? {}));
  return map;
}

describe("runUndo — single-screen Yjs undo restores the stamped selection", () => {
  it("keeps the real Yjs redo item after canonicalizing an undo result", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("content");
    const before = `<!doctype html><html><body></body></html>`;
    const after = `<!doctype html><html><body><main><button>Added</button></main></body></html>`;
    ytext.insert(0, before);
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
    });
    writeCollabText(ydoc, ytext, after, LOCAL_EDIT_ORIGIN);
    um.stopCapturing();
    expect(um.canUndo()).toBe(true);

    runUndo(
      baseArgs({
        activeFile: {
          id: "file-1",
          fileType: "html",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        um,
        undoManagerRef: { current: um },
        ydoc,
        queueFileContentSave: vi.fn(),
      }),
    );

    const canonicalUndo = ytext.toJSON();
    expect(canonicalUndo).not.toBe(before);
    expect(canonicalUndo).toContain("data-agent-native-node-id");
    expect(canonicalUndo).not.toContain("<button>Added</button>");
    expect(um.canRedo()).toBe(true);

    runRedo(
      baseArgs({
        activeFile: {
          id: "file-1",
          fileType: "html",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        um,
        undoManagerRef: { current: um },
        ydoc,
        recordLocalContentHistoryChangeFallback: vi.fn(),
        queueFileContentSave: vi.fn(),
      }) as unknown as Parameters<typeof runRedo>[0],
    );

    const canonicalRedo = ytext.toJSON();
    expect(canonicalRedo).toContain(">Added</button>");
    expect(canonicalRedo).toContain("data-agent-native-node-id");
    expect(um.canUndo()).toBe(true);

    runUndo(
      baseArgs({
        activeFile: {
          id: "file-1",
          fileType: "html",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        um,
        undoManagerRef: { current: um },
        ydoc,
        queueFileContentSave: vi.fn(),
      }),
    );
    expect(ytext.toJSON()).toContain("data-agent-native-node-id");
    expect(ytext.toJSON()).not.toContain(">Added</button>");
    expect(um.canRedo()).toBe(true);
  });

  it("restores selectedElement/selectedLayerIds from the popped stack item's stamp, not the (already-cleared) current selection", () => {
    const { element: restoredElement, node } = sourceBoxA();
    const meta = fakeStackItem({
      [YJS_UNDO_SELECTION_META_KEY]: {
        selectedElement: restoredElement,
        selectedLayerIds: [node.id],
        sourceContentByFileId: { "file-1": CONTENT_WITH_BOX_A },
        sourceFileIdByFileId: { "file-1": "file-1" },
      },
    });
    let currentContent = CONTENT_WITHOUT_BOX_A;
    const um = {
      canUndo: () => true,
      undo: vi.fn(() => {
        currentContent = CONTENT_WITH_BOX_A;
        return { meta };
      }),
    };

    let capturedElement: unknown;
    let capturedLayerIds: unknown;
    const setSelectedElement = vi.fn((updater: unknown) => {
      capturedElement =
        typeof updater === "function"
          ? (updater as (p: unknown) => unknown)(null)
          : updater;
    });
    const setSelectedLayerIdsState = vi.fn((updater: unknown) => {
      capturedLayerIds =
        typeof updater === "function"
          ? (updater as (p: unknown) => unknown)([])
          : updater;
    });

    const queueFileContentSave = vi.fn();
    runUndo(
      baseArgs({
        um,
        undoManagerRef: { current: um },
        queueFileContentSave,
        ydoc: { getText: () => ({ toJSON: () => currentContent }) },
        setSelectedElement,
        setSelectedLayerIdsState,
      }),
    );

    expect(um.undo).toHaveBeenCalledTimes(1);
    expect(capturedElement).toMatchObject({
      sourceId: restoredElement.sourceId,
      sourceLayerIdentity: { screenId: "file-1", nodeId: node.id },
    });
    expect(capturedElement).not.toBeNull();
    expect(capturedLayerIds).toEqual([node.id]);
    expect(capturedLayerIds).not.toEqual(["box-a"]);
    expect(queueFileContentSave).toHaveBeenCalledWith(
      "file-1",
      CONTENT_WITH_BOX_A,
      expect.objectContaining({
        expectedVersionHash: sourceContentHash(CONTENT_WITHOUT_BOX_A),
      }),
    );
  });

  it("falls back to the refresh-from-content heuristic when nothing was stamped", () => {
    const um = {
      canUndo: () => true,
      undo: vi.fn(() => ({ meta: new Map() })),
    };

    let capturedElement: unknown = "untouched";
    const setSelectedElement = vi.fn((updater: unknown) => {
      capturedElement =
        typeof updater === "function"
          ? (updater as (p: unknown) => unknown)(null)
          : updater;
    });

    runUndo(
      baseArgs({ um, undoManagerRef: { current: um }, setSelectedElement }),
    );

    expect(capturedElement).toBeNull();
  });
});
