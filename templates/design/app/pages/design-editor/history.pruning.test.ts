import { describe, expect, it } from "vitest";

import {
  filterFileDeletionHistoryEntry,
  pruneGeometryHistoryEntryForDeletedFiles,
  remapFileDeletionHistoryEntryIds,
} from "./history";

describe("geometry history selection pruning", () => {
  it("does not restore selection to a screen deleted after the gesture", () => {
    const entry = {
      before: {
        "screen-a": { x: 0, y: 0 },
        "screen-b": { x: 20, y: 20 },
      },
      after: {
        "screen-a": { x: 10, y: 10 },
        "screen-b": { x: 20, y: 20 },
      },
      selectionBefore: {
        overviewSelectedScreenIds: ["screen-a", "screen-b"],
        selectedLayerIds: ["deleted-screen-layer"],
        activeFileId: "screen-b",
      },
      selectionAfter: {
        overviewSelectedScreenIds: ["screen-b"],
        selectedLayerIds: ["deleted-screen-layer"],
        activeFileId: "screen-b",
      },
    };

    const pruned = pruneGeometryHistoryEntryForDeletedFiles(
      entry,
      new Set(["screen-b"]),
    );

    expect(pruned).toMatchObject({
      before: { "screen-a": { x: 0, y: 0 } },
      after: { "screen-a": { x: 10, y: 10 } },
      selectionBefore: {
        overviewSelectedScreenIds: ["screen-a"],
        selectedLayerIds: [],
        activeFileId: null,
      },
      selectionAfter: {
        overviewSelectedScreenIds: [],
        selectedLayerIds: [],
        activeFileId: null,
      },
    });
  });

  it("keeps layer selection when its active screen survives the prune", () => {
    const entry = {
      before: {
        "screen-a": { x: 0, y: 0 },
        "screen-b": { x: 20, y: 20 },
      },
      after: {
        "screen-a": { x: 10, y: 10 },
        "screen-b": { x: 20, y: 20 },
      },
      selectionBefore: {
        overviewSelectedScreenIds: ["screen-a", "screen-b"],
        selectedLayerIds: ["surviving-layer"],
        activeFileId: "screen-a",
      },
    };

    const pruned = pruneGeometryHistoryEntryForDeletedFiles(
      entry,
      new Set(["screen-b"]),
    );

    expect(pruned?.selectionBefore).toEqual({
      overviewSelectedScreenIds: ["screen-a"],
      selectedLayerIds: ["surviving-layer"],
      activeFileId: "screen-a",
    });
  });
});

describe("file deletion history", () => {
  const entry = {
    files: [
      {
        id: "old-a",
        filename: "a.html",
        content: "<main>A</main>",
        fileType: "html",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
        geometry: { x: 10, y: 20, width: 320, height: 240 },
      },
      {
        id: "old-b",
        filename: "b.html",
        content: "<main>B</main>",
        fileType: "html",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    ],
  };

  it("remaps recreated database ids without losing file or frame data", () => {
    expect(remapFileDeletionHistoryEntryIds(entry, ["new-a", "new-b"])).toEqual(
      {
        files: [
          { ...entry.files[0], id: "new-a" },
          { ...entry.files[1], id: "new-b" },
        ],
      },
    );
  });

  it("keeps only files whose delete mutation succeeded", () => {
    expect(filterFileDeletionHistoryEntry(entry, new Set(["old-b"]))).toEqual({
      files: [entry.files[1]],
    });
  });
});
