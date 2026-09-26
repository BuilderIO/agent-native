import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AddScreenArgs } from "./add-screen";
import { runAddScreen } from "./add-screen";
import type { CreateScreenFrameArgs } from "./create-screen-frame";
import { runCreateScreenFrame } from "./create-screen-frame";

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

function deferredCreateFileMutation() {
  let onSuccess: ((result: { id: string }) => void) | undefined;
  const createFileMutation = {
    mutate: vi.fn((_input: unknown, options: any) => {
      onSuccess = options.onSuccess;
    }),
  };
  return {
    createFileMutation:
      createFileMutation as unknown as CreateScreenFrameArgs["createFileMutation"],
    complete: () => onSuccess?.({ id: "created-screen" }),
  };
}

const initialGeometry: CanvasFrameGeometryById = {
  edited: { x: 10, y: 20, width: 640, height: 480 },
  deleted: { x: 700, y: 20, width: 320, height: 240 },
};

const latestGeometry: CanvasFrameGeometryById = {
  edited: { x: 10, y: 20, width: 720, height: 480 },
  addedWhilePending: { x: 1100, y: 20, width: 300, height: 200 },
};

function expectLatestGeometryOnCreate(
  startCreate: (
    designDataJsonRef: RefObject<Record<string, unknown>>,
    createFileMutation: ReturnType<typeof deferredCreateFileMutation>,
    writeFrameGeometrySnapshot: ReturnType<typeof vi.fn>,
  ) => void,
) {
  const designDataJsonRef = ref<Record<string, unknown>>({
    canvasFrames: initialGeometry,
  });
  const deferred = deferredCreateFileMutation();
  const writeFrameGeometrySnapshot = vi.fn();

  startCreate(designDataJsonRef, deferred, writeFrameGeometrySnapshot);
  expect(writeFrameGeometrySnapshot).not.toHaveBeenCalled();

  designDataJsonRef.current = {
    canvasFrames: latestGeometry,
  };
  deferred.complete();

  expect(writeFrameGeometrySnapshot).toHaveBeenCalledTimes(1);
  const written = writeFrameGeometrySnapshot.mock.calls[0]?.[0] as
    | CanvasFrameGeometryById
    | undefined;
  expect(written?.edited).toEqual(latestGeometry.edited);
  expect(written?.addedWhilePending).toEqual(latestGeometry.addedWhilePending);
  expect(written?.deleted).toBeUndefined();
  expect(written?.["created-screen"]).toBeTruthy();
}

describe("screen creation geometry snapshots", () => {
  it.each([
    ["toolbar Add Screen", runAddScreen],
    ["drawn Screen frame", runCreateScreenFrame],
  ])("uses current geometry after %s finishes", (_label, runCommand) => {
    expectLatestGeometryOnCreate(
      (designDataJsonRef, deferred, writeFrameGeometrySnapshot) => {
        const shared = {
          canEditDesign: true,
          createFileMutation: deferred.createFileMutation,
          designDataJsonRef,
          files: [] as never,
          focusCreatedScreen: vi.fn(),
          id: "design-1",
          optimisticallyInsertCreatedFile: vi.fn(),
          queryClient: { invalidateQueries: vi.fn() } as never,
          recordFileCreationHistoryEntry: vi.fn(),
          t: (key: string) => key,
          writeFrameGeometrySnapshot,
        };

        if (runCommand === runAddScreen) {
          runAddScreen({
            ...shared,
            overviewScreens: [],
          } as AddScreenArgs);
        } else {
          runCreateScreenFrame(
            {
              ...shared,
              locallyPinnedHeightIdsRef: ref(new Set<string>()),
            } as CreateScreenFrameArgs,
            { x: 20, y: 30, width: 300, height: 200 },
          );
        }
      },
    );
  });

  it("places toolbar Add Screen after visible breakpoint previews", () => {
    const deferred = deferredCreateFileMutation();
    const writeFrameGeometrySnapshot = vi.fn();
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: {
        "screen-1": { x: 555, y: 0, width: 402, height: 874 },
        "screen-2": { x: 1013, y: 0, width: 320, height: 640 },
      },
    });

    runAddScreen({
      canEditDesign: true,
      createFileMutation: deferred.createFileMutation,
      designDataJsonRef,
      files: [],
      focusCreatedScreen: vi.fn(),
      id: "design-1",
      optimisticallyInsertCreatedFile: vi.fn(),
      overviewScreens: [
        {
          id: "screen-1",
          filename: "screen-1.html",
          content: "",
          updatedAt: "",
          heightPinned: false,
          width: 402,
          height: 874,
          breakpointWidths: [360, 375],
        },
        {
          id: "screen-2",
          filename: "screen-2.html",
          content: "",
          updatedAt: "",
          heightPinned: false,
          width: 320,
          height: 640,
        },
      ],
      queryClient: { invalidateQueries: vi.fn() } as never,
      recordFileCreationHistoryEntry: vi.fn(),
      t: (key: string) => key,
      writeFrameGeometrySnapshot,
    });

    deferred.complete();

    const written = writeFrameGeometrySnapshot.mock.calls[0]?.[0] as
      | CanvasFrameGeometryById
      | undefined;
    expect(written?.["created-screen"]).toMatchObject({
      x: 1796,
      y: 0,
      width: 320,
      height: 640,
    });
  });
});
