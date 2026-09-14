import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { YJS_UNDO_SELECTION_META_KEY } from "@/pages/design-editor/history";

import { runUndo } from "./undo";

/**
 * Figma parity (§13 Undo/Redo + Part 3's alt-drag-duplicate resolution):
 * "deleting an element then one undo restores it with its original
 * position, name and selection" / "one undo after alt-drag removes the
 * copy and restores selection to the original" (parity-undo-redo.spec.ts,
 * parity-alt-drag-duplicate.spec.ts).
 *
 * Single-screen content edits are undone through the Yjs `Y.UndoManager`
 * (`um.undo()`), not the overview `contentUndoStackRef` path — that path's
 * `restoreSelectionSnapshot` never even runs here (view mode is "single").
 * Before this fix, undo only ever "refreshed" whatever was CURRENTLY
 * selected against the restored content — for a delete, current selection
 * is already null (delete cleared it), so the refresh is a no-op and
 * selection stays empty forever, never returning to the deleted element.
 */
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
  it("restores selectedElement/selectedLayerIds from the popped stack item's stamp, not the (already-cleared) current selection", () => {
    const restoredElement = { selector: "#box-a" } as unknown as ElementInfo;
    const meta = fakeStackItem({
      [YJS_UNDO_SELECTION_META_KEY]: {
        selectedElement: restoredElement,
        selectedLayerIds: ["box-a"],
      },
    });
    const um = {
      canUndo: () => true,
      undo: vi.fn(() => ({ meta })),
    };

    let capturedElement: unknown;
    let capturedLayerIds: unknown;
    const setSelectedElement = vi.fn((updater: unknown) => {
      capturedElement =
        typeof updater === "function"
          ? (updater as (p: unknown) => unknown)(null) // delete already cleared selection to null
          : updater;
    });
    const setSelectedLayerIdsState = vi.fn((updater: unknown) => {
      capturedLayerIds =
        typeof updater === "function"
          ? (updater as (p: unknown) => unknown)([]) // delete already cleared this too
          : updater;
    });

    runUndo(
      baseArgs({
        um,
        undoManagerRef: { current: um },
        setSelectedElement,
        setSelectedLayerIdsState,
      }),
    );

    expect(um.undo).toHaveBeenCalledTimes(1);
    expect(capturedElement).toBe(restoredElement);
    expect(capturedLayerIds).toEqual(["box-a"]);
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

    // Unstamped + already-null prev: the heuristic's own no-op ("if (!prev)
    // return prev") — proves this path is untouched by the fix, not that a
    // regression made it disappear.
    expect(capturedElement).toBeNull();
  });
});
