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
      selectionBefore,
    },
    yjsUndoSelection: {
      undoManagerRef,
      undoStackTopBefore: previousYjsItem,
      selectionBefore,
      recorded: true,
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
  expect(createdLocalEntry.selectionBefore).toEqual(selectionBefore);
  expect(readYjsUndoSelection(previousYjsItem)).toBeUndefined();
  expect(previousLocalEntry.selectionAfter).toBeUndefined();
});

it("keeps the first undo selection and advances redo selection when creations coalesce", () => {
  const originalSelection = {
    selectedElement: null,
    selectedLayerIds: ["original"],
  };
  const firstSelection = {
    selectedElement: null,
    selectedLayerIds: ["first-frame"],
  };
  const secondSelection = {
    selectedElement: null,
    selectedLayerIds: ["second-frame"],
  };
  const previousItem = { meta: new Map<unknown, unknown>() };
  const createdItem = { meta: new Map<unknown, unknown>() };
  const undoManagerRef = {
    current: { undoStack: [previousItem, createdItem] } as any,
  };
  const previousEntry: ContentHistoryEntry = {
    fileId: "board",
    before: "<main />",
    after: "<main><rect /></main>",
  };
  const createdEntry: ContentHistoryEntry = {
    fileId: "board",
    before: "<main><rect /></main>",
    after: '<main><rect /><frame id="first-frame" /></main>',
  };
  const contentUndoStackRef = { current: [previousEntry, createdEntry] };
  const contentHistorySelectionAfterRef = {
    current: new WeakMap(),
  } as { current: ContentHistorySelectionAfterMap };
  const createHistorySelection = (
    nodeId: string,
    undoStackTopBefore: typeof previousItem | typeof createdItem,
    selectionBefore: typeof originalSelection | typeof firstSelection,
    contentUndoStackTopBefore: ContentHistoryEntry,
  ) => ({
    contentUndoStackRef,
    contentHistorySelectionAfterRef,
    contentUndoStackTopBefore,
    captureCurrentSelection: () => ({
      overviewSelectedScreenIds: [],
      selectedLayerIds: [nodeId],
      activeFileId: "board",
    }),
    yjsUndoSelection: {
      undoManagerRef,
      undoStackTopBefore,
      selectionBefore,
      recorded: true,
    },
  });

  runPrimitiveCreated(
    primitiveCreatedArgs(),
    "board",
    "first-frame",
    undefined,
    createHistorySelection(
      "first-frame",
      previousItem,
      originalSelection,
      previousEntry,
    ),
  );
  runPrimitiveCreated(
    primitiveCreatedArgs(),
    "board",
    "second-frame",
    undefined,
    createHistorySelection(
      "second-frame",
      createdItem,
      firstSelection,
      createdEntry,
    ),
  );

  expect(readYjsUndoSelection(createdItem)).toEqual(originalSelection);
  expect(readYjsRedoSelection(createdItem)).toEqual(secondSelection);
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
