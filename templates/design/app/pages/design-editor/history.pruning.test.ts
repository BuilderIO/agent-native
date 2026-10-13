import { describe, expect, it } from "vitest";

import {
  contentHistoryEntryFromChanges,
  filterFileDeletionHistoryEntry,
  partitionContentHistoryEntry,
  pruneGeometryHistoryEntryForDeletedFiles,
  pruneSelectionHistoryStackIds,
  remapFileDeletionHistoryEntryIds,
  remapSelectionHistoryStackIds,
  restoreFileContentHistoryOrderToken,
} from "@/pages/design-editor/history";

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

  it("preserves surviving explicit Screen provenance when pruning a deleted Screen", () => {
    const pruned = pruneGeometryHistoryEntryForDeletedFiles(
      {
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
          explicitOverviewScreenIds: ["screen-a", "screen-b"],
          selectedLayerIds: [],
          activeFileId: "screen-a",
        },
        selectionAfter: {
          overviewSelectedScreenIds: ["screen-a"],
          explicitOverviewScreenIds: ["screen-a"],
          selectedLayerIds: [],
          activeFileId: "screen-a",
        },
      },
      new Set(["screen-b"]),
    );

    expect(pruned?.selectionBefore?.explicitOverviewScreenIds).toEqual([
      "screen-a",
    ]);
    expect(pruned?.selectionAfter?.explicitOverviewScreenIds).toEqual([
      "screen-a",
    ]);
  });
});

describe("selection history screen provenance", () => {
  it("remaps explicit Screen IDs with the rest of a selection history entry", () => {
    const stack = [
      {
        before: {
          overviewSelectedScreenIds: ["screen-a"],
          explicitOverviewScreenIds: ["screen-a"],
          selectedLayerIds: ["layer-a"],
          activeFileId: "screen-a",
        },
        after: {
          overviewSelectedScreenIds: ["screen-a"],
          explicitOverviewScreenIds: ["screen-a"],
          selectedLayerIds: ["layer-b"],
          activeFileId: "screen-a",
        },
      },
    ];

    expect(
      remapSelectionHistoryStackIds(
        stack,
        new Map([["screen-a", "restored-screen"]]),
      )[0],
    ).toMatchObject({
      before: {
        overviewSelectedScreenIds: ["restored-screen"],
        explicitOverviewScreenIds: ["restored-screen"],
        activeFileId: "restored-screen",
      },
      after: {
        overviewSelectedScreenIds: ["restored-screen"],
        explicitOverviewScreenIds: ["restored-screen"],
        activeFileId: "restored-screen",
      },
    });
  });

  it("prunes deleted explicit Screens and preserves surviving provenance", () => {
    const stack = [
      {
        before: {
          overviewSelectedScreenIds: ["keep-screen", "deleted-screen"],
          explicitOverviewScreenIds: ["keep-screen", "deleted-screen"],
          selectedLayerIds: ["layer-before"],
          activeFileId: "keep-screen",
        },
        after: {
          overviewSelectedScreenIds: ["keep-screen"],
          explicitOverviewScreenIds: ["keep-screen"],
          selectedLayerIds: ["layer-after"],
          activeFileId: "keep-screen",
        },
      },
    ];

    const pruned = pruneSelectionHistoryStackIds(
      stack,
      new Set(["deleted-screen"]),
    );

    expect(pruned).toHaveLength(1);
    expect(pruned[0]?.before.explicitOverviewScreenIds).toEqual([
      "keep-screen",
    ]);
    expect(pruned[0]?.after.explicitOverviewScreenIds).toEqual(["keep-screen"]);
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

describe("partitionContentHistoryEntry", () => {
  const screenA = {
    fileId: "screen-a",
    before: "<main>A before</main>",
    after: "<main>A after</main>",
  };
  const screenB = {
    fileId: "screen-b",
    before: "<main>B before</main>",
    after: "<main>B after</main>",
  };
  const grouped = { changes: [screenA, screenB] };

  it("keeps the unavailable side on the remainder instead of dropping it", () => {
    expect(
      partitionContentHistoryEntry(grouped, ["screen-a"], "screen-a"),
    ).toEqual({
      available: [screenA],
      remainder: [screenB],
    });
    expect(contentHistoryEntryFromChanges([screenA])).toEqual(screenA);
    expect(contentHistoryEntryFromChanges([screenB])).toEqual(screenB);
  });

  it("returns the whole group when every screen is available", () => {
    expect(
      partitionContentHistoryEntry(grouped, ["screen-a", "screen-b"]),
    ).toEqual({
      available: [screenA, screenB],
      remainder: [],
    });
  });

  it("restores a file-content order token when a remainder stays on the stack", () => {
    const historyOrder: Array<"geometry" | "file-content"> = [
      "geometry",
      "file-content",
    ];
    historyOrder.pop();
    const { remainder } = partitionContentHistoryEntry(
      grouped,
      ["screen-a"],
      "screen-a",
    );
    restoreFileContentHistoryOrderToken(
      historyOrder,
      Boolean(contentHistoryEntryFromChanges(remainder)),
    );
    expect(historyOrder).toEqual(["geometry", "file-content"]);
  });
});
