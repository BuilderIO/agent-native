import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import {
  getDuplicateScreenGeometry,
  runDuplicateScreen,
  type DuplicateScreenArgs,
} from "./duplicate-screen";

function duplicateArgs(
  overrides: Partial<DuplicateScreenArgs> = {},
): DuplicateScreenArgs {
  const source = {
    id: "source",
    filename: "index.html",
    fileType: "html",
    content: "<main></main>",
    createdAt: "",
    updatedAt: "",
  };
  return {
    canEditDesign: true,
    createFileAsync: vi.fn().mockResolvedValue({ id: "copy" }),
    deleteFileAsync: vi.fn().mockResolvedValue({ deleted: true }),
    designDataJsonRef: {
      current: {
        canvasFrames: {
          source: { x: 0, y: 0, width: 640, height: 480 },
        },
      },
    },
    duplicateRecoveryRef: { current: new Map() },
    files: [source],
    focusCreatedScreen: vi.fn(),
    id: "design-1",
    liveFrameGeometryRef: {
      current: {
        source: { x: 0, y: 0, width: 640, height: 480 },
      },
    },
    optimisticallyInsertCreatedFile: vi.fn(),
    overviewScreens: [],
    pendingDuplicateGeometriesRef: { current: new Map() },
    pendingDuplicateFilenamesRef: { current: new Set() },
    duplicateInFlightRef: { current: new Set() },
    queryClient: {
      getQueryData: vi.fn().mockReturnValue(undefined),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    },
    recordFileCreationHistoryEntry: vi.fn(),
    t: (key: string) => key,
    updateDesignAsync: vi.fn().mockResolvedValue({}),
    writeFrameGeometrySnapshot: vi.fn(),
    ...overrides,
  } as DuplicateScreenArgs;
}

function duplicateArgsWithOccupiedFrame(
  occupiedGeometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    z?: number;
  },
  sourceGeometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    z?: number;
  } = { x: 0, y: 0, width: 640, height: 480, z: 0 },
): DuplicateScreenArgs {
  return duplicateArgs({
    files: [
      {
        id: "source",
        filename: "index.html",
        fileType: "html",
        content: "<main></main>",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "occupied",
        filename: "occupied.html",
        fileType: "html",
        content: "<main>occupied</main>",
        createdAt: "",
        updatedAt: "",
      },
    ],
    overviewScreens: [{ id: "occupied" } as any],
    designDataJsonRef: {
      current: {
        canvasFrames: { source: sourceGeometry, occupied: occupiedGeometry },
      },
    },
    liveFrameGeometryRef: {
      current: { source: sourceGeometry, occupied: occupiedGeometry },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDuplicateScreenGeometry", () => {
  it("uses the first unoccupied slot to the right and leaves stacking to the command", () => {
    const source = { x: 200, y: 720, width: 320, height: 240, z: 4 };

    expect(getDuplicateScreenGeometry(source, [])).toMatchObject({
      x: 576,
      y: 720,
      width: 320,
      height: 240,
    });
  });

  it("uses the next free slot instead of jumping past farther screens", () => {
    const source = { x: 200, y: 720, width: 320, height: 240, z: 4 };
    const occupied = [
      { x: 576, y: 720, width: 320, height: 240, z: 90 },
      { x: 1800, y: 720, width: 320, height: 240, z: 100 },
      { x: 576, y: 1200, width: 320, height: 240, z: 200 },
    ];

    expect(getDuplicateScreenGeometry(source, occupied)).toMatchObject({
      x: 952,
      y: 720,
      width: 320,
      height: 240,
    });
  });

  it("uses a moved source and skips occupied frames in the same row", () => {
    const source = { x: 1000, y: 240, width: 800, height: 600, z: 4 };
    const occupied = [
      { x: 1856, y: 240, width: 800, height: 600, z: 5 },
      { x: 400, y: 1200, width: 800, height: 600, z: 9 },
    ];

    expect(getDuplicateScreenGeometry(source, occupied)).toMatchObject({
      x: 2712,
      y: 240,
      width: 800,
      height: 600,
    });
  });
});

describe("runDuplicateScreen", () => {
  it("places Cmd+D duplicates in the first free slot from their requested position", async () => {
    const args = duplicateArgsWithOccupiedFrame({
      x: 696,
      y: 0,
      width: 640,
      height: 480,
    });

    await runDuplicateScreen(args, "source", {
      mode: "alt-click",
      canvasPosition: { x: 696, y: 0 },
    });

    expect(args.focusCreatedScreen).toHaveBeenCalledWith(
      "copy",
      expect.objectContaining({ x: 1392, y: 0 }),
      expect.any(Object),
    );
  });

  it("rechecks persisted frames after a pending duplicate moves its slot", async () => {
    const args = duplicateArgsWithOccupiedFrame(
      { x: 1112, y: 0, width: 500, height: 500 },
      { x: 0, y: 0, width: 500, height: 500 },
    );
    args.pendingDuplicateGeometriesRef.current.set("pending.html", {
      x: 556,
      y: 0,
      width: 100,
      height: 500,
    });

    await runDuplicateScreen(args, "source", {
      mode: "alt-click",
      canvasPosition: { x: 556, y: 0 },
    });

    expect(args.focusCreatedScreen).toHaveBeenCalledWith(
      "copy",
      expect.objectContaining({ x: 1668, y: 0 }),
      expect.any(Object),
    );
  });

  it("preserves an explicit Alt-drag drop position", async () => {
    const args = duplicateArgsWithOccupiedFrame({
      x: 696,
      y: 0,
      width: 640,
      height: 480,
    });

    await runDuplicateScreen(args, "source", {
      mode: "alt-drag",
      canvasPosition: { x: 696, y: 0 },
    });

    expect(args.focusCreatedScreen).toHaveBeenCalledWith(
      "copy",
      expect.objectContaining({ x: 696, y: 0 }),
      expect.any(Object),
    );
  });

  it("stacks an Alt-drag copy above overlapping screens", async () => {
    const args = duplicateArgsWithOccupiedFrame({
      x: 600,
      y: 0,
      width: 640,
      height: 480,
      z: 90,
    });

    await runDuplicateScreen(args, "source", {
      mode: "alt-drag",
      canvasPosition: { x: 696, y: 0 },
    });

    expect(args.focusCreatedScreen).toHaveBeenCalledWith(
      "copy",
      expect.objectContaining({ x: 696, y: 0, z: 91 }),
      expect.any(Object),
    );
  });

  it("cleans up a partial create so the same duplicate can be retried", async () => {
    let activeFilename: string | undefined;
    let sequence = 0;
    const createFileAsync = vi.fn().mockImplementation(async ({ filename }) => {
      if (activeFilename === filename) throw new Error("filename collision");
      activeFilename = filename;
      sequence += 1;
      return { id: `copy-${sequence}` };
    });
    const deleteFileAsync = vi.fn().mockImplementation(async ({ id }) => {
      expect(id).toBe("copy-1");
      activeFilename = undefined;
      return { id, deleted: true };
    });
    const updateDesignAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error("metadata failed"))
      .mockResolvedValueOnce({});
    const args = duplicateArgs({
      createFileAsync:
        createFileAsync as DuplicateScreenArgs["createFileAsync"],
      deleteFileAsync:
        deleteFileAsync as DuplicateScreenArgs["deleteFileAsync"],
      updateDesignAsync:
        updateDesignAsync as DuplicateScreenArgs["updateDesignAsync"],
    });

    runDuplicateScreen(args, "source");
    await vi.waitFor(() => expect(deleteFileAsync).toHaveBeenCalledTimes(1));
    expect(args.focusCreatedScreen).not.toHaveBeenCalled();

    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-2",
        expect.any(Object),
        expect.any(Object),
      ),
    );

    expect(createFileAsync).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("metadata failed");
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("treats a create response without an id as a failed duplicate", async () => {
    const createFileAsync = vi.fn().mockResolvedValue({});
    const args = duplicateArgs({
      createFileAsync,
      queryClient: {
        getQueryData: vi.fn().mockReturnValue({
          files: [
            {
              id: "stale-copy",
              filename: "index-copy.html",
              fileType: "html",
              content: "<main></main>",
            },
          ],
        }),
        invalidateQueries: vi.fn(),
        setQueryData: vi.fn(),
      } as unknown as DuplicateScreenArgs["queryClient"],
    });

    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("create-file returned no id"),
      ),
    );

    expect(toast.success).not.toHaveBeenCalled();
    expect(args.optimisticallyInsertCreatedFile).not.toHaveBeenCalled();
    expect(args.focusCreatedScreen).not.toHaveBeenCalled();

    runDuplicateScreen(args, "source");
    await vi.waitFor(() => expect(createFileAsync).toHaveBeenCalledTimes(2));
  });

  it("preserves source stacking order across a multi-screen duplicate", async () => {
    const first = {
      id: "first",
      filename: "first.html",
      fileType: "html",
      content: "<main>first</main>",
      createdAt: "",
      updatedAt: "",
    };
    const second = {
      id: "second",
      filename: "second.html",
      fileType: "html",
      content: "<main>second</main>",
      createdAt: "",
      updatedAt: "",
    };
    const args = duplicateArgs({
      files: [first, second],
      overviewScreens: [
        { id: "first", width: 640, height: 480 },
        { id: "second", width: 640, height: 480 },
      ] as any,
      createFileAsync: vi
        .fn()
        .mockResolvedValueOnce({ id: "copy-first" })
        .mockResolvedValueOnce({ id: "copy-second" }),
      designDataJsonRef: {
        current: {
          canvasFrames: {
            first: { x: 0, y: 0, width: 640, height: 480, z: 0 },
            second: { x: 800, y: 0, width: 640, height: 480, z: 1 },
          },
        },
      },
      liveFrameGeometryRef: {
        current: {
          first: { x: 0, y: 0, width: 640, height: 480, z: 0 },
          second: { x: 800, y: 0, width: 640, height: 480, z: 1 },
        },
      },
    });
    const historyBatchId = "duplicate-test";

    const duplicateStackSourceIds = ["first", "second"];
    runDuplicateScreen(args, "first", {
      canvasPosition: { x: 0, y: 600 },
      duplicateStackSourceIds,
      historyBatchId,
    });
    runDuplicateScreen(args, "second", {
      canvasPosition: { x: 800, y: 600 },
      duplicateStackSourceIds,
      historyBatchId,
    });

    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledTimes(2),
    );
    const zById = Object.fromEntries(
      (args.focusCreatedScreen as any).mock.calls.map(
        ([id, geometry]: [string, { z?: number }]) => [id, geometry.z],
      ),
    );
    expect(zById).toEqual({ "copy-first": 1, "copy-second": 3 });
    expect(args.designDataJsonRef.current.canvasFrames).toMatchObject({
      first: { z: 0 },
      second: { z: 2 },
    });
    expect(args.recordFileCreationHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicateStack: {
          before: expect.objectContaining({
            first: { x: 0, y: 0, width: 640, height: 480, z: 0 },
            second: { x: 800, y: 0, width: 640, height: 480, z: 1 },
          }),
          after: expect.objectContaining({
            second: { x: 800, y: 0, width: 640, height: 480, z: 2 },
          }),
        },
      }),
    );
  });

  it("inserts a Cmd+D copy directly above its source and shifts higher screens", async () => {
    const screens = ["a", "b", "c"].map((id) => ({
      id,
      filename: `${id}.html`,
      fileType: "html",
      content: `<main>${id}</main>`,
      createdAt: "",
      updatedAt: "",
    }));
    const geometry = {
      a: { x: 0, y: 0, width: 320, height: 240, z: 0 },
      b: { x: 376, y: 0, width: 320, height: 240, z: 1 },
      c: { x: 752, y: 0, width: 320, height: 240, z: 2 },
    };
    const args = duplicateArgs({
      files: screens,
      overviewScreens: screens.map(({ id }) => ({ id })) as any,
      designDataJsonRef: { current: { canvasFrames: geometry } },
      liveFrameGeometryRef: { current: geometry },
    });

    runDuplicateScreen(args, "a", {
      mode: "alt-click",
      canvasPosition: { x: 376, y: 0 },
      duplicateStackSourceIds: ["a"],
    });

    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy",
        expect.objectContaining({ x: 1128, z: 1 }),
        expect.any(Object),
      ),
    );
    expect(args.designDataJsonRef.current.canvasFrames).toMatchObject({
      a: { z: 0 },
      b: { z: 2 },
      c: { z: 3 },
      copy: { z: 1 },
    });
  });

  it("reserves repeated Cmd+D copies against a committed copy while screen props catch up", async () => {
    const screens = ["a", "b", "c"].map((id) => ({
      id,
      filename: `${id}.html`,
      fileType: "html",
      content: `<main>${id}</main>`,
      createdAt: "",
      updatedAt: "",
    }));
    const geometry = {
      a: { x: 0, y: 0, width: 320, height: 240, z: 0 },
      b: { x: 376, y: 0, width: 320, height: 240, z: 1 },
      c: { x: 1128, y: 0, width: 320, height: 240, z: 2 },
    };
    const args = duplicateArgs({
      files: screens,
      overviewScreens: screens.map(({ id }) => ({ id })) as any,
      createFileAsync: vi
        .fn()
        .mockResolvedValueOnce({ id: "copy" })
        .mockResolvedValueOnce({ id: "copy-2" }),
      designDataJsonRef: { current: { canvasFrames: geometry } },
      liveFrameGeometryRef: { current: geometry },
    });

    const duplicateSource = () =>
      runDuplicateScreen(args, "a", {
        mode: "alt-click",
        canvasPosition: { x: 376, y: 0 },
        duplicateStackSourceIds: ["a"],
      });
    await duplicateSource();
    expect(args.designDataJsonRef.current.canvasFrames).toMatchObject({
      a: { z: 0 },
      copy: { x: 752, z: 1 },
      b: { z: 2 },
      c: { z: 3 },
    });
    await duplicateSource();

    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledTimes(2),
    );
    expect(args.designDataJsonRef.current.canvasFrames).toMatchObject({
      a: { x: 0, z: 0 },
      copy: { x: 752, z: 2 },
      b: { x: 376, z: 3 },
      c: { x: 1128, z: 4 },
      "copy-2": { x: 1504, z: 1 },
    });
  });

  it("keeps persisted occupancy when a committed copy has only a live z value", async () => {
    const screens = ["a", "b", "copy", "c"].map((id) => ({
      id,
      filename: `${id}.html`,
      fileType: "html",
      content: `<main>${id}</main>`,
      createdAt: "",
      updatedAt: "",
    }));
    const geometry = {
      a: { x: 0, y: 0, width: 320, height: 240, z: 0 },
      b: { x: 376, y: 0, width: 320, height: 240, z: 1 },
      copy: { x: 752, y: 0, width: 320, height: 240, z: 2 },
      c: { x: 1128, y: 0, width: 320, height: 240, z: 3 },
    };
    const args = duplicateArgs({
      files: screens,
      overviewScreens: screens.map(({ id }) => ({ id })) as any,
      createFileAsync: vi.fn().mockResolvedValue({ id: "copy-2" }),
      designDataJsonRef: { current: { canvasFrames: geometry } },
      liveFrameGeometryRef: {
        current: {
          a: geometry.a,
          b: geometry.b,
          copy: { z: 4 },
          c: geometry.c,
        },
      },
    });

    runDuplicateScreen(args, "a", {
      mode: "alt-click",
      duplicateStackSourceIds: ["a"],
    });

    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-2",
        expect.objectContaining({ x: 1504, z: 1 }),
        expect.any(Object),
      ),
    );
    expect(args.designDataJsonRef.current.canvasFrames).toMatchObject({
      a: { z: 0 },
      copy: { x: 752, z: 3 },
      b: { x: 376, z: 2 },
      c: { z: 4 },
      "copy-2": { x: 1504, z: 1 },
    });
  });

  it("keeps an Alt-drag copy above overlapping screens at the requested point", async () => {
    const source = {
      id: "source",
      filename: "source.html",
      fileType: "html",
      content: "<main>source</main>",
      createdAt: "",
      updatedAt: "",
    };
    const overlay = {
      id: "overlay",
      filename: "overlay.html",
      fileType: "html",
      content: "<main>overlay</main>",
      createdAt: "",
      updatedAt: "",
    };
    const geometry = {
      source: { x: 0, y: 0, width: 500, height: 500, z: 0 },
      overlay: { x: 180, y: 120, width: 500, height: 500, z: 9 },
    };
    const args = duplicateArgs({
      files: [source, overlay],
      overviewScreens: [{ id: "source" }, { id: "overlay" }] as any,
      designDataJsonRef: { current: { canvasFrames: geometry } },
      liveFrameGeometryRef: { current: geometry },
    });

    runDuplicateScreen(args, "source", {
      mode: "alt-drag",
      canvasPosition: { x: 200, y: 140 },
    });

    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy",
        expect.objectContaining({ x: 200, y: 140, z: 10 }),
        expect.any(Object),
      ),
    );
    expect(args.designDataJsonRef.current.canvasFrames).toMatchObject({
      source: { z: 0 },
      overlay: { z: 9 },
      copy: { x: 200, y: 140, z: 10 },
    });
  });

  it("reserves first-free multi-select copies against screens and earlier copies", async () => {
    const screens = [
      { id: "a", filename: "a.html", x: 0 },
      { id: "b", filename: "b.html", x: 376 },
      { id: "d", filename: "d.html", x: 1128 },
    ].map(({ id, filename }) => ({
      id,
      filename,
      fileType: "html",
      content: `<main>${id}</main>`,
      createdAt: "",
      updatedAt: "",
    }));
    const geometry = {
      a: { x: 0, y: 0, width: 320, height: 240, z: 0 },
      b: { x: 376, y: 0, width: 320, height: 240, z: 1 },
      d: { x: 1128, y: 0, width: 320, height: 240, z: 2 },
    };
    const args = duplicateArgs({
      files: screens,
      overviewScreens: screens.map(({ id }) => ({ id })) as any,
      createFileAsync: vi
        .fn()
        .mockResolvedValueOnce({ id: "copy-a" })
        .mockResolvedValueOnce({ id: "copy-b" }),
      designDataJsonRef: { current: { canvasFrames: geometry } },
      liveFrameGeometryRef: { current: geometry },
    });
    const duplicateStackSourceIds = ["a", "b"];
    runDuplicateScreen(args, "a", {
      mode: "alt-click",
      canvasPosition: { x: 376, y: 0 },
      duplicateStackSourceIds,
      historyBatchId: "multi-copy",
    });
    runDuplicateScreen(args, "b", {
      mode: "alt-click",
      canvasPosition: { x: 752, y: 0 },
      duplicateStackSourceIds,
      historyBatchId: "multi-copy",
    });

    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledTimes(2),
    );
    const copiesById = Object.fromEntries(
      (args.focusCreatedScreen as any).mock.calls.map(
        ([id, frame]: [string, { x: number }]) => [id, frame],
      ),
    );
    expect(copiesById).toMatchObject({
      "copy-a": { x: 752 },
      "copy-b": { x: 1504 },
    });
    expect(copiesById["copy-b"].x).toBeGreaterThan(1128);
  });

  it("rechecks persisted frames after pending copies push a duplicate to the right", async () => {
    const source = {
      id: "source",
      filename: "index.html",
      fileType: "html",
      content: "<main>source</main>",
      createdAt: "",
      updatedAt: "",
    };
    const occupied = {
      id: "occupied",
      filename: "occupied.html",
      fileType: "html",
      content: "<main>occupied</main>",
      createdAt: "",
      updatedAt: "",
    };
    const occupiedGeometry = { x: 1200, y: 0, width: 500, height: 100 };
    const args = duplicateArgs({
      files: [source, occupied],
      overviewScreens: [
        {
          id: "source",
          filename: "index.html",
          content: source.content,
          updatedAt: "",
          heightPinned: false,
          width: 500,
          height: 100,
        },
        {
          id: "occupied",
          filename: "occupied.html",
          content: occupied.content,
          updatedAt: "",
          heightPinned: false,
          width: 500,
          height: 100,
        },
      ],
      designDataJsonRef: {
        current: {
          canvasFrames: {
            source: { x: 288, y: 0, width: 500, height: 100 },
            occupied: occupiedGeometry,
          },
        },
      },
      liveFrameGeometryRef: {
        current: {
          source: { x: 288, y: 0, width: 500, height: 100 },
          occupied: occupiedGeometry,
        },
      },
      pendingDuplicateGeometriesRef: {
        current: new Map([
          ["pending-one.html", { x: 844, y: 0, width: 100, height: 100 }],
          ["pending-two.html", { x: 1000, y: 0, width: 100, height: 100 }],
        ]),
      },
    });

    runDuplicateScreen(args, "source", { canvasPosition: { x: 844, y: 0 } });

    expect(
      args.pendingDuplicateGeometriesRef.current.get("index-copy.html"),
    ).toMatchObject({ x: 1756 });
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy",
        expect.objectContaining({ x: 1756 }),
        expect.any(Object),
      ),
    );
  });

  it("does not retain a recovery id when cleanup rejected after deleting the row", async () => {
    const createFileAsync = vi
      .fn()
      .mockResolvedValueOnce({ id: "copy-1" })
      .mockResolvedValueOnce({ id: "copy-2" });
    const args = duplicateArgs({
      createFileAsync,
      deleteFileAsync: vi
        .fn()
        .mockRejectedValue(new Error("metadata prune failed")),
      updateDesignAsync: vi
        .fn()
        .mockRejectedValueOnce(new Error("metadata failed"))
        .mockResolvedValueOnce({}),
      queryClient: {
        getQueryData: vi.fn().mockReturnValue({ files: [] }),
        invalidateQueries: vi.fn(),
        setQueryData: vi.fn(),
      } as unknown as DuplicateScreenArgs["queryClient"],
    });

    runDuplicateScreen(args, "source");
    await vi.waitFor(() => expect(createFileAsync).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(args.duplicateRecoveryRef.current.get("index-copy.html")).toEqual(
        expect.not.objectContaining({ fileId: "copy-1" }),
      ),
    );

    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-2",
        expect.any(Object),
        expect.any(Object),
      ),
    );
    expect(createFileAsync).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent retries of one recovery entry", async () => {
    let resolveUpdate: (() => void) | undefined;
    const args = duplicateArgs({
      createFileAsync: vi.fn(),
      updateDesignAsync: vi.fn(
        () =>
          new Promise<{ id: string; updated: boolean; changed: boolean }>(
            (resolve) => {
              resolveUpdate = () =>
                resolve({ id: "design-1", updated: true, changed: true });
            },
          ),
      ) as unknown as DuplicateScreenArgs["updateDesignAsync"],
      queryClient: {
        getQueryData: vi.fn().mockReturnValue({
          files: [
            {
              id: "copy-1",
              filename: "index-copy.html",
              fileType: "html",
              content: "<main></main>",
            },
          ],
        }),
        invalidateQueries: vi.fn(),
        setQueryData: vi.fn(),
      } as unknown as DuplicateScreenArgs["queryClient"],
    });
    args.duplicateRecoveryRef.current.set("index-copy.html", {
      sourceScreenId: "source",
      fileId: "copy-1",
      content: "<main></main>",
      fileType: "html",
      geometry: { x: 696, y: 0, width: 640, height: 480 },
    });

    const first = runDuplicateScreen(args, "source");
    const second = runDuplicateScreen(args, "source");
    expect(args.createFileAsync).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(args.updateDesignAsync).toHaveBeenCalledTimes(1),
    );
    resolveUpdate?.();
    await first;
    await second;
    expect(args.focusCreatedScreen).toHaveBeenCalledTimes(1);
    expect(args.recordFileCreationHistoryEntry).toHaveBeenCalledTimes(1);
  });

  it("reuses a created row when cleanup fails", async () => {
    const source = {
      id: "source",
      filename: "index.html",
      fileType: "html",
      content: '<main data-version="one"></main>',
      createdAt: "",
      updatedAt: "",
    };
    const createFileAsync = vi.fn().mockResolvedValue({ id: "copy-1" });
    const deleteFileAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error("cleanup failed"));
    const updateDesignAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error("metadata failed"))
      .mockResolvedValueOnce({});
    const queryClient = {
      getQueryData: vi.fn().mockReturnValue({
        files: [
          {
            id: "copy-1",
            filename: "index-copy.html",
            fileType: "html",
            content: source.content,
          },
        ],
      }),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    };
    const args = duplicateArgs({
      createFileAsync:
        createFileAsync as DuplicateScreenArgs["createFileAsync"],
      deleteFileAsync:
        deleteFileAsync as DuplicateScreenArgs["deleteFileAsync"],
      files: [source],
      queryClient: queryClient as unknown as DuplicateScreenArgs["queryClient"],
      updateDesignAsync:
        updateDesignAsync as DuplicateScreenArgs["updateDesignAsync"],
    });

    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(deleteFileAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: "copy-1" }),
      ),
    );

    expect(args.duplicateRecoveryRef.current.get("index-copy.html")).toEqual(
      expect.objectContaining({
        sourceScreenId: "source",
        fileId: "copy-1",
        content: '<main data-version="one"></main>',
      }),
    );

    source.content = '<main data-version="two"></main>';
    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-1",
        expect.any(Object),
        expect.any(Object),
      ),
    );

    expect(createFileAsync).toHaveBeenCalledTimes(1);
    expect(deleteFileAsync).toHaveBeenCalledTimes(1);
    expect(args.recordFileCreationHistoryEntry).toHaveBeenCalledTimes(1);
    expect(args.optimisticallyInsertCreatedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '<main data-version="one"></main>',
      }),
    );
    expect(args.duplicateRecoveryRef.current.size).toBe(0);
  });

  it("reconciles a delayed persisted row without creating a second copy", async () => {
    let cached: unknown;
    let invalidationCount = 0;
    let requestedContent = "";
    const queryClient = {
      getQueryData: vi.fn(() => cached),
      invalidateQueries: vi.fn().mockImplementation(async () => {
        invalidationCount += 1;
        if (invalidationCount === 2) {
          cached = {
            files: [
              {
                id: "copy-1",
                filename: "index-copy.html",
                fileType: "html",
                content: requestedContent,
              },
            ],
          };
        }
      }),
      setQueryData: vi.fn(),
    };
    const createFileAsync = vi
      .fn()
      .mockImplementation(async ({ content }: { content: string }) => {
        requestedContent = content;
        return {};
      });
    const args = duplicateArgs({
      createFileAsync:
        createFileAsync as DuplicateScreenArgs["createFileAsync"],
      queryClient: queryClient as unknown as DuplicateScreenArgs["queryClient"],
    });

    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("no persisted file could be reconciled"),
      ),
    );
    expect(args.duplicateRecoveryRef.current.get("index-copy.html")).toEqual(
      expect.objectContaining({ sourceScreenId: "source" }),
    );

    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(args.focusCreatedScreen).toHaveBeenCalledWith(
        "copy-1",
        expect.any(Object),
        expect.any(Object),
      ),
    );

    expect(createFileAsync).toHaveBeenCalledTimes(1);
    expect(args.recordFileCreationHistoryEntry).toHaveBeenCalledTimes(1);
  });

  it("reserves distinct filenames while duplicate creates are in flight", async () => {
    const resolvers: Array<(value: { id: string }) => void> = [];
    const createFileAsync = vi.fn().mockImplementation(
      ({ filename }: { filename: string }) =>
        new Promise<{ id: string }>((resolve) => {
          resolvers.push(() => resolve({ id: filename }));
        }),
    );
    const args = duplicateArgs({
      createFileAsync:
        createFileAsync as DuplicateScreenArgs["createFileAsync"],
    });

    runDuplicateScreen(args, "source");
    runDuplicateScreen(args, "source");

    expect(createFileAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ filename: "index-copy.html" }),
    );
    expect(createFileAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ filename: "index-copy-2.html" }),
    );

    resolvers.forEach((resolve) => resolve({ id: "copy" }));
    await vi.waitFor(() =>
      expect(args.recordFileCreationHistoryEntry).toHaveBeenCalledTimes(2),
    );
    const geometries = (args.writeFrameGeometrySnapshot as any).mock.calls.map(
      ([geometry]: [Record<string, { x: number }>]) =>
        Object.values(geometry)
          .filter((value) => value.x !== 0)
          .slice(-1)[0],
    );
    expect(geometries[1]!.x).toBeGreaterThan(geometries[0]!.x);
  });

  it("does not report success when metadata persistence fails", async () => {
    const args = duplicateArgs({
      updateDesignAsync: vi
        .fn()
        .mockRejectedValue(new Error("metadata write failed")),
    });

    runDuplicateScreen(args, "source");
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("metadata write failed"),
    );
    expect(args.optimisticallyInsertCreatedFile).not.toHaveBeenCalled();
    expect(args.focusCreatedScreen).not.toHaveBeenCalled();
    expect(args.recordFileCreationHistoryEntry).not.toHaveBeenCalled();
  });
});
