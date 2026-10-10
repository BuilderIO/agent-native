// @vitest-environment happy-dom

import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  refetchDesignAfterGeometrySaves,
  runWriteFrameGeometrySnapshot,
} from "./write-frame-geometry-snapshot";

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
        designRefetchCancelledRef: ref(false),
        enqueueFrameGeometryDataSave,
        frameGeometrySaveTimerRef: ref(null),
        id: "design",
        liveFrameGeometryRef,
        pendingFrameGeometrySaveRef,
        queryClient: new QueryClient(),
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
        designRefetchCancelledRef: ref(false),
        enqueueFrameGeometryDataSave: vi.fn(() => true),
        frameGeometrySaveTimerRef: { current: null },
        id: "design",
        liveFrameGeometryRef,
        pendingFrameGeometrySaveRef: { current: null },
        queryClient: new QueryClient(),
      },
      after,
    );

    expect(liveFrameGeometryRef.current).toEqual(after);
    expect(liveFrameGeometryRef.current).not.toBe(after);
  });

  it("keeps the written geometry when a get-design response that predates it lands", async () => {
    const persisted: CanvasFrameGeometryById = {
      screen: { x: 0, y: 0, width: 400, height: 300 },
    };
    const nudged: CanvasFrameGeometryById = {
      screen: { x: 2, y: 0, width: 400, height: 300 },
    };
    const queryKey = ["action", "get-design", { id: "design" }];
    const persistedResponse = {
      data: JSON.stringify({ canvasFrames: persisted }),
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, persistedResponse);
    let respond: (value: typeof persistedResponse) => void = () => {};
    const inFlight = queryClient
      .fetchQuery({
        queryKey,
        queryFn: () => new Promise((resolve) => (respond = resolve)),
      })
      .catch(() => undefined);

    runWriteFrameGeometrySnapshot(
      {
        boardFileId: undefined,
        canEditDesignRef: ref(true),
        designDataJsonRef: ref<Record<string, unknown>>({
          canvasFrames: persisted,
        }),
        designRefetchCancelledRef: ref(false),
        enqueueFrameGeometryDataSave: vi.fn(() => true),
        frameGeometrySaveTimerRef: ref(null),
        id: "design",
        pendingFrameGeometrySaveRef: ref(null),
        queryClient,
      },
      nudged,
    );
    respond(persistedResponse);
    await inFlight;

    const cached = queryClient.getQueryData<{ data: string }>(queryKey);
    expect(JSON.parse(cached!.data).canvasFrames).toEqual(nudged);
  });

  it("re-runs the get-design refresh it cancelled once the geometry saves land", async () => {
    const persisted: CanvasFrameGeometryById = {
      screen: { x: 0, y: 0, width: 400, height: 300 },
    };
    const queryKey = ["action", "get-design", { id: "design" }];
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, {
      data: JSON.stringify({ canvasFrames: persisted }),
    });
    const queryFn = vi.fn(() => new Promise<never>(() => {}));
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      staleTime: Infinity,
    }).subscribe(() => {});
    void queryClient.invalidateQueries({ queryKey, exact: true });
    expect(queryFn).toHaveBeenCalledTimes(1);
    const designRefetchCancelledRef = ref(false);
    const frameGeometrySavesInFlightRef = ref(1);
    const pendingFrameGeometrySaveRef = ref(null);

    runWriteFrameGeometrySnapshot(
      {
        boardFileId: undefined,
        canEditDesignRef: ref(true),
        designDataJsonRef: ref<Record<string, unknown>>({
          canvasFrames: persisted,
        }),
        designRefetchCancelledRef,
        enqueueFrameGeometryDataSave: vi.fn(() => true),
        frameGeometrySaveTimerRef: ref(null),
        id: "design",
        pendingFrameGeometrySaveRef,
        queryClient,
      },
      { screen: { x: 2, y: 0, width: 400, height: 300 } },
    );
    const refetchArgs = {
      designRefetchCancelledRef,
      frameGeometrySavesInFlightRef,
      id: "design",
      pendingFrameGeometrySaveRef,
      queryClient,
    };
    refetchDesignAfterGeometrySaves(refetchArgs);
    expect(queryFn).toHaveBeenCalledTimes(1);

    frameGeometrySavesInFlightRef.current = 0;
    refetchDesignAfterGeometrySaves(refetchArgs);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(designRefetchCancelledRef.current).toBe(false);
    unsubscribe();
  });
});
