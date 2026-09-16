// @vitest-environment happy-dom

import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { runWriteFrameGeometrySnapshot } from "./write-frame-geometry-snapshot";

describe("runWriteFrameGeometrySnapshot", () => {
  it("publishes an accepted local rotation to the live undo snapshot", () => {
    const before: CanvasFrameGeometryById = {
      screen: { x: 0, y: 0, width: 400, height: 400, rotation: 0 },
    };
    const after: CanvasFrameGeometryById = {
      screen: { x: 0, y: 0, width: 400, height: 400, rotation: 15 },
    };
    const liveFrameGeometryRef = { current: before };
    const designDataJsonRef = {
      current: { canvasFrames: before } as Record<string, unknown>,
    };

    runWriteFrameGeometrySnapshot(
      {
        boardFileId: undefined,
        canEditDesignRef: { current: true },
        designDataJsonRef,
        enqueueFrameGeometryDataSave: vi.fn(() => true),
        frameGeometrySaveTimerRef: { current: null },
        id: "design",
        liveFrameGeometryRef,
        pendingFrameGeometrySaveRef: { current: null },
        queryClient: { setQueryData: vi.fn() } as unknown as QueryClient,
      },
      after,
    );

    expect(liveFrameGeometryRef.current).toEqual(after);
    expect(liveFrameGeometryRef.current).not.toBe(after);
  });
});
