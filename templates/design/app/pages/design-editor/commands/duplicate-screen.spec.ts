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
    pendingDuplicateFilenamesRef: { current: new Set() },
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDuplicateScreenGeometry", () => {
  it("uses a moved source and skips occupied frames in the same row", () => {
    const source = { x: 1000, y: 240, width: 800, height: 600, z: 4 };
    const occupied = [
      { x: 1856, y: 240, width: 800, height: 600, z: 5 },
      { x: 400, y: 1200, width: 800, height: 600, z: 9 },
    ];

    expect(getDuplicateScreenGeometry(source, occupied)).toEqual({
      x: 2712,
      y: 240,
      width: 800,
      height: 600,
      z: 10,
    });
  });
});

describe("runDuplicateScreen", () => {
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
    const args = duplicateArgs({
      createFileAsync: vi.fn().mockResolvedValue({}),
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
    const args = duplicateArgs({
      createFileAsync:
        createFileAsync as DuplicateScreenArgs["createFileAsync"],
      deleteFileAsync:
        deleteFileAsync as DuplicateScreenArgs["deleteFileAsync"],
      files: [source],
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
    const persistedFile = {
      id: "copy-1",
      filename: "index-copy.html",
      fileType: "html",
      content: "<main data-persisted></main>",
      createdAt: "",
      updatedAt: "",
    };
    let cached: unknown;
    let invalidationCount = 0;
    const queryClient = {
      getQueryData: vi.fn(() => cached),
      invalidateQueries: vi.fn().mockImplementation(async () => {
        invalidationCount += 1;
        if (invalidationCount === 2) cached = { files: [persistedFile] };
      }),
      setQueryData: vi.fn(),
    };
    const createFileAsync = vi.fn().mockResolvedValue({});
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
  });
});
