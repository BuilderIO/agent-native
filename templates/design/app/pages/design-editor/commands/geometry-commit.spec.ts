import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { UndoRedoOrderKind } from "../editor-state";
import type {
  GeometryHistoryEntry,
  GeometryHistorySelection,
} from "../history";
import { runGeometryCommit } from "./geometry-commit";

function runCommit(
  options?: {
    source?: "pointer" | "keyboard";
    kScaleStyleChangesByFrameId?: Record<string, []>;
  },
  before: CanvasFrameGeometryById = {
    screen: { x: 0, y: 0, width: 400, height: 400 },
  },
  after: CanvasFrameGeometryById = {
    screen: { x: 0.2, y: 0.2, width: 416.2, height: 416.2 },
  },
  seed?: {
    previousEntry?: GeometryHistoryEntry;
    lastGeometryCommitAt?: number;
    lastGeometryCommitSource?: "pointer" | "keyboard";
    historyOrder?: UndoRedoOrderKind[];
  },
) {
  const geometryUndoStackRef = {
    current: seed?.previousEntry ? [seed.previousEntry] : [],
  };
  const historyOrderRef = {
    current:
      seed?.historyOrder ??
      (seed?.previousEntry ? (["geometry"] as UndoRedoOrderKind[]) : []),
  };
  const liveFrameGeometryRef = { current: before };
  const writeFrameGeometrySnapshot = vi.fn();
  const captureLinkedContentChanges = vi.fn(() => []);
  const selection: GeometryHistorySelection = {
    overviewSelectedScreenIds: ["screen"],
    selectedLayerIds: [],
    activeFileId: null,
  };

  const committed = runGeometryCommit(
    {
      boardFileId: undefined,
      captureLinkedContentChanges,
      captureCurrentSelection: () => selection,
      clearRedoStacks: vi.fn(),
      designDataJsonRef: { current: {} },
      geometryUndoStackRef,
      historyOrderRef,
      id: "design",
      liveFrameGeometryRef,
      lastGeometryCommitAtRef: {
        current: seed?.lastGeometryCommitAt ?? 0,
      },
      lastGeometryCommitSourceRef: {
        current: seed?.lastGeometryCommitSource ?? null,
      },
      locallyPinnedHeightIdsRef: { current: new Set<string>() },
      queryClient: { setQueryData: vi.fn() } as unknown as QueryClient,
      queueFrameGeometrySave: vi.fn(),
      syncUndoRedoState: vi.fn(),
      writeFrameGeometrySnapshot,
    },
    before,
    after,
    options,
  );

  return {
    captureLinkedContentChanges,
    committed,
    geometryUndoStackRef,
    historyOrderRef,
    liveFrameGeometryRef,
    writeFrameGeometrySnapshot,
  };
}

describe("runGeometryCommit", () => {
  it("keeps a keyboard nudge separate from a preceding pointer gesture", () => {
    const geometryUndoStackRef = { current: [] as GeometryHistoryEntry[] };
    const historyOrderRef = { current: [] as UndoRedoOrderKind[] };
    const liveFrameGeometryRef = {
      current: { screen: { x: 0, y: 0, width: 400, height: 400 } },
    };
    const lastGeometryCommitAtRef = { current: 0 };
    const lastGeometryCommitSourceRef = {
      current: null as "pointer" | "keyboard" | null,
    };
    const captureCurrentSelection = (): GeometryHistorySelection => ({
      overviewSelectedScreenIds: ["screen"],
      selectedLayerIds: [],
      activeFileId: null,
    });
    const commitArgs = {
      boardFileId: undefined,
      captureCurrentSelection,
      clearRedoStacks: vi.fn(),
      designDataJsonRef: { current: {} },
      geometryUndoStackRef,
      historyOrderRef,
      id: "design",
      lastGeometryCommitAtRef,
      lastGeometryCommitSourceRef,
      liveFrameGeometryRef,
      locallyPinnedHeightIdsRef: { current: new Set<string>() },
      queryClient: { setQueryData: vi.fn() } as unknown as QueryClient,
      queueFrameGeometrySave: vi.fn(),
      syncUndoRedoState: vi.fn(),
      writeFrameGeometrySnapshot: vi.fn(),
    };
    const before = {
      screen: { x: 0, y: 0, width: 400, height: 400 },
    };
    const afterPointer = {
      screen: { x: 20, y: 0, width: 400, height: 400 },
    };
    const afterKeyboard = {
      screen: { x: 21, y: 0, width: 400, height: 400 },
    };

    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1100);
    runGeometryCommit(commitArgs, before, afterPointer, {
      source: "pointer",
    });
    runGeometryCommit(commitArgs, afterPointer, afterKeyboard, {
      source: "keyboard",
    });
    vi.restoreAllMocks();

    expect(geometryUndoStackRef.current).toHaveLength(2);
    expect(historyOrderRef.current).toEqual(["geometry", "geometry"]);
    expect(geometryUndoStackRef.current[1]?.before).toEqual(afterPointer);
  });

  it("keeps keyboard nudges for different selections separate", () => {
    const geometryUndoStackRef = { current: [] as GeometryHistoryEntry[] };
    const historyOrderRef = { current: [] as UndoRedoOrderKind[] };
    const liveFrameGeometryRef = {
      current: {
        screenA: { x: 0, y: 0, width: 400, height: 400 },
        screenB: { x: 500, y: 0, width: 400, height: 400 },
      },
    };
    const lastGeometryCommitAtRef = { current: 0 };
    const lastGeometryCommitSourceRef = {
      current: null as "pointer" | "keyboard" | null,
    };
    let selectedScreenId = "screenA";
    const captureCurrentSelection = (): GeometryHistorySelection => ({
      overviewSelectedScreenIds: [selectedScreenId],
      selectedLayerIds: [],
      activeFileId: null,
    });
    const commitArgs = {
      boardFileId: undefined,
      captureCurrentSelection,
      clearRedoStacks: vi.fn(),
      designDataJsonRef: { current: {} },
      geometryUndoStackRef,
      historyOrderRef,
      id: "design",
      lastGeometryCommitAtRef,
      lastGeometryCommitSourceRef,
      liveFrameGeometryRef,
      locallyPinnedHeightIdsRef: { current: new Set<string>() },
      queryClient: { setQueryData: vi.fn() } as unknown as QueryClient,
      queueFrameGeometrySave: vi.fn(),
      syncUndoRedoState: vi.fn(),
      writeFrameGeometrySnapshot: vi.fn(),
    };
    const before = liveFrameGeometryRef.current;
    const afterScreenA = {
      ...before,
      screenA: { ...before.screenA, x: 1 },
    };
    const afterScreenB = {
      ...afterScreenA,
      screenB: { ...afterScreenA.screenB, x: 501 },
    };

    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1100);
    runGeometryCommit(commitArgs, before, afterScreenA, {
      source: "keyboard",
    });
    selectedScreenId = "screenB";
    runGeometryCommit(commitArgs, afterScreenA, afterScreenB, {
      source: "keyboard",
    });
    vi.restoreAllMocks();

    expect(geometryUndoStackRef.current).toHaveLength(2);
    expect(historyOrderRef.current).toEqual(["geometry", "geometry"]);
    expect(geometryUndoStackRef.current[1]?.before).toEqual(afterScreenA);
  });

  it("keeps keyboard nudges separate across content history", () => {
    const before = {
      screen: { x: 0, y: 0, width: 400, height: 400 },
    };
    const previousEntry: GeometryHistoryEntry = {
      before: { screen: { ...before.screen, x: -1 } },
      after: before,
      selectionAfter: {
        overviewSelectedScreenIds: ["screen"],
        selectedLayerIds: [],
        activeFileId: null,
      },
    };
    const result = runCommit(
      { source: "keyboard" },
      before,
      { screen: { ...before.screen, x: 1 } },
      {
        previousEntry,
        lastGeometryCommitAt: Date.now(),
        lastGeometryCommitSource: "keyboard",
        historyOrder: ["geometry", "content"],
      },
    );

    expect(result.geometryUndoStackRef.current).toHaveLength(2);
    expect(result.historyOrderRef.current).toEqual([
      "geometry",
      "content",
      "geometry",
    ]);
  });

  it("preserves fractional frame geometry when a K-scale target has no style changes", () => {
    const before = {
      screen: { x: 0, y: 0, width: 400, height: 400 },
      other: { x: 2000.4, y: 0.6, width: 500.3, height: 700.1 },
    };
    const after = {
      screen: { x: 0.2, y: 0.2, width: 416.2, height: 416.2 },
      other: before.other,
    };
    const result = runCommit(
      { kScaleStyleChangesByFrameId: { screen: [] } },
      before,
      after,
    );
    const expected = {
      screen: { x: 0.2, y: 0.2, width: 416.2, height: 416.2 },
      other: before.other,
    };

    expect(result.committed).toBe(true);
    expect(result.writeFrameGeometrySnapshot).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({ syncViewportFrameIds: ["screen"] }),
    );
    expect(result.geometryUndoStackRef.current[0]?.after).toEqual(expected);
    expect(result.liveFrameGeometryRef.current).toEqual(expected);
    expect(result.captureLinkedContentChanges).toHaveBeenCalledWith(
      ["screen"],
      { screen: [] },
    );
  });

  it("keeps whole-pixel quantization for ordinary frame gestures", () => {
    const result = runCommit();
    const expected = {
      screen: { x: 0, y: 0, width: 416, height: 416 },
    };

    expect(result.committed).toBe(true);
    expect(result.writeFrameGeometrySnapshot).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({ syncViewportFrameIds: ["screen"] }),
    );
    expect(result.geometryUndoStackRef.current[0]?.after).toEqual(expected);
    expect(result.liveFrameGeometryRef.current).toEqual(expected);
  });

  it("does not round unchanged fractional geometry on selected or unselected frames", () => {
    const before = {
      screen: { x: 0.2, y: 0.2, width: 416.2, height: 416.2 },
      other: { x: 2000.4, y: 0.6, width: 500.3, height: 700.1 },
    };
    const after = {
      screen: { ...before.screen, x: 5.4 },
      other: before.other,
    };
    const result = runCommit(undefined, before, after);

    expect(result.committed).toBe(true);
    expect(result.writeFrameGeometrySnapshot).toHaveBeenCalledWith(
      {
        screen: { x: 5, y: 0.2, width: 416.2, height: 416.2 },
        other: before.other,
      },
      undefined,
    );
    expect(result.geometryUndoStackRef.current[0]?.after).toEqual({
      screen: { x: 5, y: 0.2, width: 416.2, height: 416.2 },
      other: before.other,
    });
  });

  it("publishes the live snapshot for a coalesced keyboard commit", () => {
    const before = {
      screen: { x: 0, y: 0, width: 400, height: 400 },
    };
    const previousEntry: GeometryHistoryEntry = {
      before: { screen: { ...before.screen, x: -1 } },
      after: before,
      selectionAfter: {
        overviewSelectedScreenIds: ["screen"],
        selectedLayerIds: [],
        activeFileId: null,
      },
    };
    const after = {
      screen: { ...before.screen, x: 1 },
    };

    const result = runCommit({ source: "keyboard" }, before, after, {
      previousEntry,
      lastGeometryCommitAt: Date.now(),
      lastGeometryCommitSource: "keyboard",
    });

    expect(result.liveFrameGeometryRef.current).toEqual(after);
    expect(result.writeFrameGeometrySnapshot).not.toHaveBeenCalled();
  });
});
