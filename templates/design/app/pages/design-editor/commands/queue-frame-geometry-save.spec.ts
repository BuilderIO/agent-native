// @vitest-environment happy-dom

import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import {
  buildFrameGeometryDataOperations,
  clearAcknowledgedDesignDataOperationsThroughRevision,
  rebaseDesignDataWithPendingOperations,
  stagePendingDesignDataOperations,
  type DesignDataOperation,
  type PendingDesignDataOperations,
} from "@/pages/design-editor/data-operations";
import {
  getCanvasFrameGeometry,
  staleGeometryFrameIds,
} from "@/pages/design-editor/design-data-geometry-utils";
import { applyGeometryHistoryDiff } from "@/pages/design-editor/history";

import { runQueueFrameGeometrySave } from "./queue-frame-geometry-save";

const ref = <T>(current: T) => ({ current });

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("runQueueFrameGeometrySave", () => {
  it("keeps the newest nudge across a stale response and an older acknowledgment", () => {
    vi.useFakeTimers();
    const before: CanvasFrameGeometryById = {
      screen: { x: 0, y: 0, width: 400, height: 300 },
      other: { x: 11, y: 0, width: 400, height: 300 },
    };
    const firstNudge: CanvasFrameGeometryById = {
      ...before,
      screen: { ...before.screen, x: 1 },
    };
    const latestNudge: CanvasFrameGeometryById = {
      ...before,
      screen: { ...before.screen, x: 2 },
    };
    const olderOperations: DesignDataOperation[] = [
      { op: "set", path: ["canvasFrames", "screen"], value: firstNudge.screen },
      {
        op: "set",
        path: ["canvasFrames", "other"],
        value: { ...before.other, x: 11 },
      },
    ];
    const pendingFrameGeometryOperationsForUnloadRef = ref(
      stagePendingDesignDataOperations({}, olderOperations, 1),
    );
    const frameGeometryOperationsInFlightRef = ref<PendingDesignDataOperations>(
      stagePendingDesignDataOperations({}, olderOperations, 1),
    );
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: firstNudge,
    });
    const frameGeometryOperationRevisionRef = ref(1);
    const journalOutboxEntry = vi.fn(async () => true);
    const createFrameGeometryOutboxEntry = vi.fn(
      (dataOperations: readonly DesignDataOperation[], revision: number) =>
        createDesignSaveOutboxEntry({
          designId: "design",
          actorScope: "editor-session",
          actionName: "update-design",
          resourceId: "design",
          operationSource: "editor-session",
          operationRevision: revision,
          payload: { dataOperations, operationRevision: revision },
        }),
    );
    const args = {
      boardFileId: undefined,
      canEditDesignRef: ref(true),
      createFrameGeometryOutboxEntry,
      designDataJsonRef,
      flushPendingFrameGeometrySave: vi.fn(),
      frameGeometryOperationRevisionRef,
      frameGeometryOperationsInFlightRef,
      frameGeometrySaveTimerRef: ref<number | null>(null),
      id: "design",
      journalOutboxEntry,
      pendingFrameGeometryOperationsForUnloadRef,
      pendingFrameGeometrySaveRef: ref<{
        geometryById: CanvasFrameGeometryById;
        previousGeometry: CanvasFrameGeometryById;
      } | null>(null),
    };

    runQueueFrameGeometrySave(args, latestNudge);

    const currentFrameRevision =
      frameGeometryOperationsInFlightRef.current[
        JSON.stringify(["canvasFrames", "screen"])
      ]?.revision;
    const pendingUnloadFrameRevision =
      pendingFrameGeometryOperationsForUnloadRef.current[
        JSON.stringify(["canvasFrames", "screen"])
      ]?.revision;
    const unrelatedFrameRevision =
      frameGeometryOperationsInFlightRef.current[
        JSON.stringify(["canvasFrames", "other"])
      ]?.revision;
    expect(currentFrameRevision).toBe(2);
    expect(pendingUnloadFrameRevision).toBe(2);
    expect(unrelatedFrameRevision).toBe(1);
    expect(
      pendingFrameGeometryOperationsForUnloadRef.current[
        JSON.stringify(["canvasFrames", "screen"])
      ]?.operation,
    ).toEqual({
      op: "set",
      path: ["canvasFrames", "screen"],
      value: latestNudge.screen,
    });
    expect(createFrameGeometryOutboxEntry).toHaveBeenCalledWith(
      [
        {
          op: "set",
          path: ["canvasFrames", "other"],
          value: { ...before.other, x: 11 },
        },
        {
          op: "set",
          path: ["canvasFrames", "screen"],
          value: latestNudge.screen,
        },
      ],
      2,
    );

    const staleServerData: Record<string, unknown> = {
      canvasFrames: firstNudge,
    };
    const displayedBeforeAcknowledgment = rebaseDesignDataWithPendingOperations(
      staleServerData,
      frameGeometryOperationsInFlightRef.current,
    );
    expect(
      getCanvasFrameGeometry(displayedBeforeAcknowledgment).screen?.x,
    ).toBe(2);

    pendingFrameGeometryOperationsForUnloadRef.current =
      clearAcknowledgedDesignDataOperationsThroughRevision(
        pendingFrameGeometryOperationsForUnloadRef.current,
        1,
      );
    frameGeometryOperationsInFlightRef.current =
      clearAcknowledgedDesignDataOperationsThroughRevision(
        frameGeometryOperationsInFlightRef.current,
        1,
      );
    expect(
      pendingFrameGeometryOperationsForUnloadRef.current[
        JSON.stringify(["canvasFrames", "screen"])
      ]?.revision,
    ).toBe(2);
    expect(
      frameGeometryOperationsInFlightRef.current[
        JSON.stringify(["canvasFrames", "screen"])
      ]?.revision,
    ).toBe(2);
    expect(
      pendingFrameGeometryOperationsForUnloadRef.current[
        JSON.stringify(["canvasFrames", "other"])
      ],
    ).toBeUndefined();
    expect(
      frameGeometryOperationsInFlightRef.current[
        JSON.stringify(["canvasFrames", "other"])
      ],
    ).toBeUndefined();
    const displayedAfterAcknowledgment = rebaseDesignDataWithPendingOperations(
      staleServerData,
      frameGeometryOperationsInFlightRef.current,
    );
    const liveGeometry = getCanvasFrameGeometry(displayedAfterAcknowledgment);
    expect(liveGeometry.screen?.x).toBe(2);
    expect(
      staleGeometryFrameIds(
        { before, after: latestNudge },
        liveGeometry,
        latestNudge,
      ),
    ).toEqual([]);

    const undoGeometry = applyGeometryHistoryDiff(
      liveGeometry,
      { before, after: latestNudge },
      "undo",
    );
    expect(
      buildFrameGeometryDataOperations({
        previousGeometry: liveGeometry,
        nextGeometry: undoGeometry,
        designData: displayedAfterAcknowledgment,
      }),
    ).toEqual([
      { op: "set", path: ["canvasFrames", "screen"], value: before.screen },
    ]);
  });
});
