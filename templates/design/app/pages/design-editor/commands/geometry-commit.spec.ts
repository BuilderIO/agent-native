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
    kScaleStyleChangesByFrameId?: Record<string, []>;
  },
  before: CanvasFrameGeometryById = {
    screen: { x: 0, y: 0, width: 400, height: 400 },
  },
  after: CanvasFrameGeometryById = {
    screen: { x: 0.2, y: 0.2, width: 416.2, height: 416.2 },
  },
) {
  const geometryUndoStackRef = { current: [] as GeometryHistoryEntry[] };
  const historyOrderRef = { current: [] as UndoRedoOrderKind[] };
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
      lastGeometryCommitAtRef: { current: 0 },
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
    writeFrameGeometrySnapshot,
  };
}

describe("runGeometryCommit", () => {
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
});
