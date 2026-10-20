// @vitest-environment happy-dom

import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  clearAcknowledgedDesignDataOperationsThroughRevision,
  type DesignDataOperation,
  type PendingDesignDataOperations,
  rebaseDesignDataWithPendingOperations,
  stagePendingDesignDataOperations,
} from "../data-operations";
import {
  getCanvasFrameGeometry,
  parseDesignDataJson,
} from "../design-data-geometry-utils";
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

  it("keeps unacknowledged geometry on top of a get-design response that predates it", async () => {
    const persisted: CanvasFrameGeometryById = {
      screen: { x: 0, y: 0, width: 400, height: 300 },
    };
    const nudged: CanvasFrameGeometryById = {
      screen: { x: 2, y: 0, width: 400, height: 300 },
    };
    const queryKey = ["action", "get-design", { id: "design" }];
    const responseWith = (canvasFrames: CanvasFrameGeometryById) => ({
      data: JSON.stringify({ canvasFrames }),
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, responseWith(persisted));
    let respond: (value: { data: string }) => void = () => {};
    const staleFetch = queryClient.fetchQuery({
      queryKey,
      queryFn: () => new Promise<{ data: string }>((r) => (respond = r)),
    });
    let pending: PendingDesignDataOperations = {};
    let revision = 0;
    const displayedGeometry = () =>
      getCanvasFrameGeometry(
        rebaseDesignDataWithPendingOperations(
          parseDesignDataJson(
            queryClient.getQueryData<{ data: string }>(queryKey)!.data,
          ),
          pending,
        ),
      );

    runWriteFrameGeometrySnapshot(
      {
        boardFileId: undefined,
        canEditDesignRef: ref(true),
        designDataJsonRef: ref<Record<string, unknown>>({
          canvasFrames: persisted,
        }),
        enqueueFrameGeometryDataSave: (operations: DesignDataOperation[]) => {
          revision += 1;
          pending = stagePendingDesignDataOperations(
            pending,
            operations,
            revision,
          );
          return true;
        },
        frameGeometrySaveTimerRef: ref(null),
        id: "design",
        pendingFrameGeometrySaveRef: ref(null),
        queryClient,
      },
      nudged,
    );
    respond(responseWith(persisted));
    await staleFetch;

    expect(displayedGeometry()).toEqual(nudged);

    pending = clearAcknowledgedDesignDataOperationsThroughRevision(
      pending,
      revision,
    );
    queryClient.setQueryData(queryKey, responseWith(nudged));
    expect(displayedGeometry()).toEqual(nudged);
  });

  it("lets a refetch someone awaits during a nudge resolve with the fresh response", async () => {
    const persisted: CanvasFrameGeometryById = {
      screen: { x: 0, y: 0, width: 400, height: 300 },
    };
    const queryKey = ["action", "get-design", { id: "design" }];
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, {
      data: JSON.stringify({ canvasFrames: persisted }),
      files: [{ id: "screen" }],
    });
    let respond: (value: unknown) => void = () => {};
    const unsubscribe = new QueryObserver(queryClient, {
      queryKey,
      queryFn: () => new Promise((resolve) => (respond = resolve)),
      staleTime: Infinity,
    }).subscribe(() => {});
    const awaitedRefetch = queryClient.refetchQueries({
      queryKey,
      exact: true,
    });

    runWriteFrameGeometrySnapshot(
      {
        boardFileId: undefined,
        canEditDesignRef: ref(true),
        designDataJsonRef: ref<Record<string, unknown>>({
          canvasFrames: persisted,
        }),
        enqueueFrameGeometryDataSave: vi.fn(() => true),
        frameGeometrySaveTimerRef: ref(null),
        id: "design",
        pendingFrameGeometrySaveRef: ref(null),
        queryClient,
      },
      { screen: { x: 2, y: 0, width: 400, height: 300 } },
    );
    respond({
      data: JSON.stringify({ canvasFrames: persisted }),
      files: [{ id: "screen" }, { id: "created-screen" }],
    });
    await awaitedRefetch;

    expect(
      queryClient.getQueryData<{ files: Array<{ id: string }> }>(queryKey)!
        .files,
    ).toEqual([{ id: "screen" }, { id: "created-screen" }]);
    unsubscribe();
  });
});
