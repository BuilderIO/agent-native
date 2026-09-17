import { describe, expect, it, vi } from "vitest";

import {
  getDuplicateScreenGeometry,
  runDuplicateScreen,
} from "./duplicate-screen";

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

  it("does not report success when metadata persistence fails", async () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    };
    const optimisticallyInsertCreatedFile = vi.fn();
    const focusCreatedScreen = vi.fn();
    const recordFileCreationHistoryEntry = vi.fn();
    const updateDesignAsync = vi
      .fn()
      .mockRejectedValue(new Error("metadata write failed"));

    runDuplicateScreen(
      {
        canEditDesign: true,
        createFileAsync: vi.fn().mockResolvedValue({ id: "screen-copy" }),
        designDataJsonRef: {
          current: {
            screenMetadata: {
              "screen-source": { sourceType: "localhost", width: 400 },
            },
            localhostScreens: {
              "screen-source": { path: "/settings" },
            },
          },
        },
        files: [
          {
            id: "screen-source",
            filename: "settings.html",
            content: "<main>Settings</main>",
            fileType: "html",
          },
        ],
        focusCreatedScreen,
        id: "design-1",
        liveFrameGeometryRef: {
          current: {
            "screen-source": {
              x: 0,
              y: 0,
              width: 400,
              height: 800,
            },
          },
        },
        optimisticallyInsertCreatedFile,
        overviewScreens: [],
        queryClient,
        recordFileCreationHistoryEntry,
        t: (key: string) => key,
        updateDesignAsync,
        writeFrameGeometrySnapshot: vi.fn(),
      } as any,
      "screen-source",
    );

    await vi.waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1),
    );
    expect(optimisticallyInsertCreatedFile).not.toHaveBeenCalled();
    expect(focusCreatedScreen).not.toHaveBeenCalled();
    expect(recordFileCreationHistoryEntry).not.toHaveBeenCalled();
  });
});
