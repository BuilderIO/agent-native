import type {
  ContentTrashItem,
  ContentTrashPurgeSpace,
} from "@shared/content-trash";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  readClientAppState: vi.fn(async () => appState.value),
}));

import {
  type ContentTrashPurgeStart,
  clearTrashSelection,
  changeTrashSort,
  extendTrashSelection,
  loadedTrashSelection,
  nearestVisibleTrashRow,
  readTrashPurgeStarts,
  reconcileTrashBrowseFilters,
  restoredTrashItemIds,
  selectedTrashItems,
  trashDeleteRequest,
  trashEmptyRequest,
  trashRestoreTargets,
  trashSelectionCount,
  trashSelectionState,
  trashMatchingFilters,
  trashFilterMembershipKey,
  trashOperationIdFromError,
  trashPurgeStartAfterError,
  trashRestoreCollectionId,
  toggleVisibleTrashSelection,
  upsertTrashPurgeStarts,
  visibleTrashItems,
} from "./use-content-trash";

function purgeSpace(spaceId: string, canPurge = true): ContentTrashPurgeSpace {
  return { spaceId, name: spaceId, canPurge };
}

function purgeStart(
  fields: Partial<ContentTrashPurgeStart> = {},
): ContentTrashPurgeStart {
  return {
    spaceId: "space-a",
    planId: "plan-a",
    idempotencyKey: "key-a",
    status: "starting",
    operationId: null,
    error: null,
    ...fields,
  };
}

beforeEach(() => {
  appState.value = null;
});

function trashItem(
  documentId: string,
  fields: Partial<ContentTrashItem> = {},
): ContentTrashItem {
  return {
    documentId,
    trashRootId: documentId,
    spaceId: "space-a",
    canRestore: true,
    ...fields,
  } as ContentTrashItem;
}

describe("Trash selection", () => {
  it("deduplicates loaded IDs and plans them per workspace", () => {
    const selection = loadedTrashSelection(["a", "b", "a", "c"]);
    const items = [
      trashItem("a"),
      trashItem("b", { spaceId: "space-b" }),
      trashItem("c"),
    ];

    expect(trashSelectionCount(selection)).toBe(3);
    expect(
      trashDeleteRequest(selection, items, [
        purgeSpace("space-a"),
        purgeSpace("space-b"),
      ]),
    ).toEqual({
      kind: "delete",
      targets: [
        {
          spaceId: "space-a",
          input: { mode: "selection", documentIds: ["a", "c"] },
        },
        {
          spaceId: "space-b",
          input: { mode: "selection", documentIds: ["b"] },
        },
      ],
      unavailableSpaceIds: [],
    });
  });

  it("never plans a selected row in a workspace the caller can't purge", () => {
    const items = [
      trashItem("mine"),
      trashItem("viewer-owned", { spaceId: "viewer-space" }),
    ];

    expect(
      trashDeleteRequest(
        loadedTrashSelection(["mine", "viewer-owned"]),
        items,
        [purgeSpace("space-a"), purgeSpace("viewer-space", false)],
      ),
    ).toEqual({
      kind: "delete",
      targets: [
        {
          spaceId: "space-a",
          input: { mode: "selection", documentIds: ["mine"] },
        },
      ],
      unavailableSpaceIds: ["viewer-space"],
    });
  });

  it("keeps matching filters server-backed, one plan per workspace", () => {
    const filters = { query: "draft", kind: "page" as const };
    const selection = { mode: "matching" as const, filters };

    const spaces = [
      purgeSpace("space-a"),
      purgeSpace("space-b"),
      purgeSpace("viewer-space", false),
    ];

    expect(trashSelectionCount(selection)).toBeNull();
    expect(trashDeleteRequest(selection, [], spaces)).toEqual({
      kind: "delete",
      targets: [
        {
          spaceId: "space-a",
          input: {
            mode: "matching",
            filters: { ...filters, spaceId: "space-a" },
          },
        },
        {
          spaceId: "space-b",
          input: {
            mode: "matching",
            filters: { ...filters, spaceId: "space-b" },
          },
        },
      ],
      unavailableSpaceIds: ["viewer-space"],
    });
    expect(
      trashDeleteRequest(
        { mode: "matching", filters: { ...filters, spaceId: "space-b" } },
        [],
        spaces,
      ).targets,
    ).toEqual([
      {
        spaceId: "space-b",
        input: {
          mode: "matching",
          filters: { ...filters, spaceId: "space-b" },
        },
      },
    ]);
  });

  it("sorts independently from matching membership", () => {
    const sorted = changeTrashSort(
      { query: "draft", sort: "deletedAt", direction: "desc" },
      "name",
    );
    expect(sorted).toEqual({ query: "draft", sort: "name", direction: "asc" });
    expect(changeTrashSort(sorted, "name").direction).toBe("desc");
    expect(trashMatchingFilters(sorted)).toEqual({ query: "draft" });
    expect(trashFilterMembershipKey(sorted)).toBe(
      trashFilterMembershipKey({ query: "draft" }),
    );
  });

  it("withholds stale nested rows during sorting without collapsing intent", () => {
    expect(
      reconcileTrashBrowseFilters(
        { sort: "deletedAt", direction: "desc" },
        { sort: "name", direction: "asc" },
        ["root-a", "root-b"],
      ),
    ).toEqual({
      expandedIds: ["root-a", "root-b"],
      clearNestedItems: true,
    });
    expect(
      reconcileTrashBrowseFilters(
        { sort: "name", direction: "asc" },
        { sort: "name", direction: "asc" },
        ["root-a"],
      ),
    ).toEqual({ expandedIds: ["root-a"], clearNestedItems: false });
  });

  it("clears matching selection when filters change", () => {
    expect(clearTrashSelection()).toEqual({ mode: "loaded", documentIds: [] });
  });

  it("empties only purgeable workspaces, one plan each, independent of filters", () => {
    expect(
      trashEmptyRequest([
        purgeSpace("space-a"),
        purgeSpace("viewer-space", false),
        purgeSpace("space-b"),
      ]),
    ).toEqual({
      kind: "empty",
      targets: [
        { spaceId: "space-a", input: { mode: "scope", spaceId: "space-a" } },
        { spaceId: "space-b", input: { mode: "scope", spaceId: "space-b" } },
      ],
      unavailableSpaceIds: ["viewer-space"],
    });
    expect(trashEmptyRequest([])).toEqual({
      kind: "empty",
      targets: [],
      unavailableSpaceIds: [],
    });
  });

  it("clears the rows a restore receipt names, and loaded rows of that deletion when it is capped", () => {
    const at = "2026-11-01T00:00:00.000Z";
    const root = trashItem("root", { trashedAt: at });
    const items = [
      trashItem("grandchild", { trashRootId: "root", trashedAt: at }),
      trashItem("own-root", { trashedAt: at }),
      trashItem("child", { trashRootId: "root", trashedAt: at }),
      trashItem("newer-child", {
        trashRootId: "root",
        trashedAt: "2026-11-02T00:00:00.000Z",
      }),
      root,
    ];

    expect([...restoredTrashItemIds(root, items, null)].sort()).toEqual([
      "child",
      "grandchild",
      "root",
    ]);
    expect(
      [
        ...restoredTrashItemIds(root, items, {
          affectedDocumentIds: ["root", "unloaded"],
          affectedDocumentIdsComplete: true,
        }),
      ].sort(),
    ).toEqual(["root", "unloaded"]);
    expect(
      [
        ...restoredTrashItemIds(root, items, {
          affectedDocumentIds: ["root", "unloaded"],
          affectedDocumentIdsComplete: false,
        }),
      ].sort(),
    ).toEqual(["child", "grandchild", "root", "unloaded"]);
  });

  it("restores Collections, legacy rows included, through the Collection path", () => {
    expect(
      trashRestoreCollectionId(
        trashItem("legacy-row", {
          databaseId: null,
          legacyRestoreDatabaseId: "legacy-db",
        }),
      ),
    ).toBe("legacy-db");
    expect(
      trashRestoreCollectionId(
        trashItem("collection", {
          databaseId: "db-1",
          legacyRestoreDatabaseId: null,
        }),
      ),
    ).toBe("db-1");
    expect(
      trashRestoreCollectionId(
        trashItem("page", { databaseId: null, legacyRestoreDatabaseId: null }),
      ),
    ).toBeNull();
  });

  it("restores each selected root once and skips rows it brings back", () => {
    const root = trashItem("root");
    const child = trashItem("child", { trashRootId: "root" });
    const other = trashItem("other");
    const locked = trashItem("locked", { canRestore: false });

    expect(trashRestoreTargets([root, child, other, locked])).toEqual([
      root,
      other,
    ]);
    expect(trashRestoreTargets([child])).toEqual([child]);
  });

  it("retains a persisted operation receipt from a dispatch failure", () => {
    expect(
      trashOperationIdFromError({ details: { operationId: "operation-1" } }),
    ).toBe("operation-1");
    expect(trashOperationIdFromError(new Error("network"))).toBeNull();
  });

  it("calls a start failed only when the server refused it", () => {
    const start = purgeStart();

    expect(
      trashPurgeStartAfterError(
        start,
        { status: 500, details: { operationId: "operation-1" } },
        "fallback",
      ),
    ).toMatchObject({ status: "started", operationId: "operation-1" });
    expect(
      trashPurgeStartAfterError(start, { status: 409 }, "fallback"),
    ).toMatchObject({ status: "failed", error: "fallback" });
    expect(
      trashPurgeStartAfterError(start, new TypeError("Failed to fetch"), "x"),
    ).toMatchObject({ status: "unknown", idempotencyKey: "key-a" });
    expect(
      trashPurgeStartAfterError(start, { status: 502 }, "fallback"),
    ).toMatchObject({ status: "unknown" });
  });

  it("updates a start by plan, so an older request can't drop a newer one's", () => {
    const a = purgeStart({ status: "started", operationId: "operation-a" });
    const b = purgeStart({ spaceId: "space-b", planId: "plan-b" });
    const legacy = purgeStart({
      planId: null,
      idempotencyKey: null,
      status: "started",
      operationId: "operation-old",
    });

    expect(
      upsertTrashPurgeStarts([legacy, a, b], [{ ...b, status: "unknown" }]),
    ).toEqual([legacy, a, { ...b, status: "unknown" }]);
    expect(
      upsertTrashPurgeStarts([a], [purgeStart({ planId: "plan-c" })]),
    ).toHaveLength(2);
  });

  it("reloads saved starts, turning an interrupted one into unknown with its original key", async () => {
    appState.value = {
      purgeStarts: [
        purgeStart({ status: "starting" }),
        purgeStart({
          planId: "plan-b",
          status: "started",
          operationId: "operation-b",
        }),
      ],
    };

    await expect(readTrashPurgeStarts()).resolves.toEqual([
      purgeStart({ status: "unknown" }),
      purgeStart({
        planId: "plan-b",
        status: "started",
        operationId: "operation-b",
      }),
    ]);

    appState.value = { operationIds: ["operation-old"] };
    await expect(readTrashPurgeStarts()).resolves.toEqual([
      {
        spaceId: null,
        planId: null,
        idempotencyKey: null,
        status: "started",
        operationId: "operation-old",
        error: null,
      },
    ]);

    appState.value = { purgeStarts: [{ planId: "plan-a", status: "done" }] };
    await expect(readTrashPurgeStarts()).rejects.toThrow(/malformed/);
  });

  it("resolves nested-only selected rows from all visible item metadata", () => {
    const root = { documentId: "root", canRestore: true } as any;
    const nested = { documentId: "nested", canRestore: true } as any;

    expect(selectedTrashItems([root, nested, nested], ["nested"])).toEqual([
      nested,
    ]);
  });

  it("includes expanded nested rows in visible order and removes collapsed rows", () => {
    const root = { documentId: "root" } as any;
    const sibling = { documentId: "sibling" } as any;
    const nested = { documentId: "nested" } as any;
    expect(
      visibleTrashItems([root, sibling], { root: [nested, nested] }, ["root"]),
    ).toEqual([root, nested, sibling]);
    expect(visibleTrashItems([root, sibling], { root: [nested] }, [])).toEqual([
      root,
      sibling,
    ]);
  });

  it("selects every visible row and reports an indeterminate subset", () => {
    expect(trashSelectionState(["a", "b", "c"], ["a", "outside"])).toBe(
      "indeterminate",
    );
    expect(toggleVisibleTrashSelection(["a", "b"], ["outside"])).toEqual([
      "outside",
      "a",
      "b",
    ]);
    expect(
      toggleVisibleTrashSelection(["a", "b"], ["a", "b", "outside"]),
    ).toEqual(["outside"]);
  });

  it("extends selection through contiguous visible rows", () => {
    expect(extendTrashSelection(["a", "b", "c", "d"], ["d"], "a", "c")).toEqual(
      ["d", "a", "b", "c"],
    );
  });

  it("restores focus to the nearest surviving row", () => {
    expect(nearestVisibleTrashRow([], ["a", "b"], null)).toBe("a");
    expect(nearestVisibleTrashRow(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
    expect(nearestVisibleTrashRow(["a", "b", "c"], ["a"], "c")).toBe("a");
  });
});
