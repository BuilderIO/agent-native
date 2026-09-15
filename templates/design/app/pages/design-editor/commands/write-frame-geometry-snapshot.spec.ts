import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { runWriteFrameGeometrySnapshot } from "./write-frame-geometry-snapshot";

const ref = <T>(current: T) => ({ current });

describe("runWriteFrameGeometrySnapshot", () => {
  it("replaces a pending keyboard save when history replays the queued snapshot", () => {
    const persisted = {
      screen: { x: 0, y: 0, width: 400, height: 300 },
    };
    const queued = {
      screen: { x: 8, y: 0, width: 400, height: 300 },
    };
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: persisted,
    });
    const pendingFrameGeometrySaveRef = ref({
      geometryById: queued,
      previousGeometry: persisted,
    });
    const liveFrameGeometryRef = ref(queued);
    const enqueueFrameGeometryDataSave = vi.fn(() => true);

    runWriteFrameGeometrySnapshot(
      {
        boardFileId: undefined,
        canEditDesignRef: ref(true),
        designDataJsonRef,
        enqueueFrameGeometryDataSave,
        frameGeometrySaveTimerRef: ref(null),
        id: "design",
        liveFrameGeometryRef,
        pendingFrameGeometrySaveRef,
        queryClient: { setQueryData: vi.fn() } as unknown as QueryClient,
      },
      persisted,
      { replacePendingGeometrySave: true },
    );

    expect(enqueueFrameGeometryDataSave).toHaveBeenCalledWith([
      {
        op: "set",
        path: ["canvasFrames", "screen"],
        value: persisted.screen,
      },
    ]);
    expect(pendingFrameGeometrySaveRef.current).toBeNull();
    expect(liveFrameGeometryRef.current).toEqual(persisted);
  });
});
