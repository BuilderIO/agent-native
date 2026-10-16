import { expect, it, vi } from "vitest";

import type {
  ContentHistoryEntry,
  ContentHistoryChange,
  ContentHistorySelectionAfterMap,
  GeometryHistorySelection,
} from "@/pages/design-editor/history";
import {
  readYjsRedoSelection,
  readYjsUndoSelection,
} from "@/pages/design-editor/history";

import {
  runPrimitiveCreated,
  type PrimitiveCreatedArgs,
} from "./primitive-created";

it("stamps the selection established by primitive creation into content and Yjs redo history", () => {
  const previousEntry: ContentHistoryEntry = {
    fileId: "board",
    before: "<main />",
    after: "<main><rect /></main>",
  };
  const createdEntry: ContentHistoryEntry = {
    fileId: "board",
    before: "<main><rect /></main>",
    after: "<main><rect /><frame /></main>",
  };
  const contentUndoStackRef = { current: [previousEntry, createdEntry] };
  const previousLocalEntry: ContentHistoryChange = {
    fileId: "board",
    before: "<main />",
    after: "<main><rect /></main>",
  };
  const createdLocalEntry: ContentHistoryChange = {
    fileId: "board",
    before: "<main><rect /></main>",
    after: "<main><rect /><frame /></main>",
  };
  const localContentUndoStackRef = {
    current: [previousLocalEntry, createdLocalEntry],
  };
  const contentHistorySelectionAfterRef: {
    current: ContentHistorySelectionAfterMap;
  } = { current: new WeakMap() };
  const selectionAfter: GeometryHistorySelection = {
    overviewSelectedScreenIds: [],
    selectedLayerIds: ["frame"],
    activeFileId: "board",
  };
  const captureCurrentSelection = vi.fn(() => selectionAfter);
  const previousYjsItem = { meta: new Map() };
  const createdYjsItem = { meta: new Map() };
  const undoManagerRef = {
    current: { undoStack: [previousYjsItem, createdYjsItem] } as any,
  };
  const selectionBefore = {
    selectedElement: null,
    selectedLayerIds: ["old-layer"],
  };

  runPrimitiveCreated(primitiveCreatedArgs(), "board", "frame", undefined, {
    contentUndoStackRef,
    contentHistorySelectionAfterRef,
    contentUndoStackTopBefore: previousEntry,
    captureCurrentSelection,
    localContentUndoSelection: {
      undoStackRef: localContentUndoStackRef,
      undoStackTopBefore: previousLocalEntry,
    },
    yjsUndoSelection: {
      undoManagerRef,
      undoStackTopBefore: previousYjsItem,
      selectionBefore,
    },
  });

  expect(captureCurrentSelection).toHaveBeenCalledOnce();
  expect(
    contentHistorySelectionAfterRef.current.get(createdEntry),
  ).toMatchObject(selectionAfter);
  expect(readYjsUndoSelection(createdYjsItem)).toEqual(selectionBefore);
  expect(readYjsRedoSelection(createdYjsItem)).toEqual({
    selectedElement: null,
    selectedLayerIds: ["frame"],
  });
  expect(createdLocalEntry.selectionAfter).toEqual({
    selectedElement: null,
    selectedLayerIds: ["frame"],
  });
  expect(readYjsUndoSelection(previousYjsItem)).toBeUndefined();
  expect(previousLocalEntry.selectionAfter).toBeUndefined();
});

function primitiveCreatedArgs(): PrimitiveCreatedArgs {
  const noop = vi.fn();

  return {
    activeLeftPanel: "file",
    boardFileId: "board",
    clearPendingOverviewLayerSelectionTimer: noop,
    pendingEmptyTextEditRef: { current: null },
    pendingOverviewLayerSelectionRef: { current: null },
    pendingOverviewScreenSelectionRef: { current: null },
    pendingTextEditNodeIdRef: { current: null },
    layersRevealedForFirstCreateRef: { current: true },
    removeEmptyTextNodeWithRetry: noop,
    setActiveFileId: noop,
    setActiveLeftPanel: noop,
    setActiveTool: noop,
    setCreatedOverviewLayerSelection: noop,
    setHoveredElement: noop,
    setMode: noop,
    setOverviewSelectedScreenIds: noop,
    setSelectedElement: noop,
    setSelectedLayerIdsState: noop,
  };
}
