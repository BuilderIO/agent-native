import type {
  ContentTrashItem,
  ContentTrashPurgeSpace,
} from "@shared/content-trash";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({ values: new Map<string, unknown>() }));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  readClientAppState: vi.fn(async (key: string) =>
    appState.values.has(key) ? structuredClone(appState.values.get(key)) : null,
  ),
  setClientAppState: vi.fn(async (key: string, value: unknown) => {
    appState.values.set(key, structuredClone(value));
  }),
}));

import {
  type ContentTrashPurgeStart,
  clearTrashSelection,
  changeTrashSort,
  extendTrashSelection,
  loadedTrashSelection,
  loadTrashPurgeStarts,
  nearestVisibleTrashRow,
  readTrashPurgeStarts,
  removeTrashPurgeStarts,
  saveTrashPurgeStarts,
  TRASH_PURGES_STATE_KEY,
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
  trashPurgeRecoveryAfterError,
  trashPurgeStartAfterError,
  trashRestoreCollectionId,
  trashRestoreRequest,
  trashRestoreSelectionCleanup,
  writeTrashContext,
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
    input: { mode: "scope", spaceId: "space-a" },
    ...fields,
  };
}

beforeEach(() => {
  appState.values.clear();
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

  it("pins each restore to the deletion Trash listed", () => {
    const at = "2026-11-01T00:00:00.000Z";
    const collectionRestore = {
      spaceId: "space-a",
      databaseDocumentId: "legacy-row",
      configurationRevision: "revision-1",
    };

    expect(
      trashRestoreRequest(
        trashItem("page", {
          databaseId: null,
          legacyRestoreDatabaseId: null,
          collectionRestore: null,
          trashedAt: at,
        }),
        "key-1",
      ),
    ).toEqual({
      kind: "page",
      input: { id: "page", expectedTrashedAt: at, idempotencyKey: "key-1" },
    });
    expect(
      trashRestoreRequest(
        trashItem("legacy-row", {
          databaseId: "legacy-db",
          legacyRestoreDatabaseId: "legacy-db",
          collectionRestore,
          trashedAt: at,
        }),
        "key-2",
      ),
    ).toEqual({
      kind: "collection",
      input: {
        target: {
          spaceId: "space-a",
          databaseId: "legacy-db",
          databaseDocumentId: "legacy-row",
        },
        expectedConfigurationRevision: "revision-1",
        idempotencyKey: "key-2",
      },
    });
    expect(
      trashRestoreRequest(
        trashItem("inline-row", {
          databaseId: "inline-db",
          legacyRestoreDatabaseId: "inline-db",
          collectionRestore: null,
          trashedAt: at,
        }),
        "key-3",
      ),
    ).toEqual({
      kind: "collection",
      input: { databaseId: "inline-db", expectedDeletedAt: at },
    });
  });

  it("clears a restored row only while it still shows the deletion that was restored", () => {
    const submitted = new Map([
      ["kept", "2026-11-01T00:00:00.000Z"],
      ["re-trashed", "2026-11-01T00:00:00.000Z"],
      ["gone", "2026-11-01T00:00:00.000Z"],
    ]);
    const loaded = [
      trashItem("kept", { trashedAt: "2026-11-01T00:00:00.000Z" }),
      trashItem("re-trashed", { trashedAt: "2026-11-03T00:00:00.000Z" }),
    ];

    expect([
      ...trashRestoreSelectionCleanup(
        new Set(["kept", "re-trashed", "gone"]),
        submitted,
        loaded,
      ),
    ]).toEqual(["kept", "gone"]);
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
    expect(
      upsertTrashPurgeStarts(
        [a],
        [{ ...a, status: "unknown", operationId: null, error: "lost" }],
      ),
    ).toEqual([a]);
    expect(
      upsertTrashPurgeStarts(
        [{ ...a, status: "starting", operationId: null }],
        [a],
      ),
    ).toEqual([a]);
  });

  it("keeps every tab's purge records through another tab's start and browsing writes", async () => {
    const a = purgeStart({ status: "started", operationId: "operation-a" });
    const b = purgeStart({ spaceId: "space-b", planId: "plan-b" });
    const tabBKnew = await loadTrashPurgeStarts();

    await saveTrashPurgeStarts([], [a]);
    await writeTrashContext({
      filters: {},
      selection: clearTrashSelection(),
      previewId: null,
    });
    await saveTrashPurgeStarts(tabBKnew, [
      b,
      { ...a, status: "unknown", operationId: null },
    ]);

    await expect(readTrashPurgeStarts()).resolves.toEqual([
      a,
      { ...b, status: "unknown" },
    ]);
    expect(appState.values.get(TRASH_PURGES_STATE_KEY)).toMatchObject({
      operationIds: ["operation-a"],
    });
    expect(appState.values.get("content-trash")).not.toHaveProperty(
      "purgeStarts",
    );

    await removeTrashPurgeStarts(new Set(["plan-b"]));
    await expect(readTrashPurgeStarts()).resolves.toEqual([a]);
  });

  it("moves older purge records out of the browsing state on first load", async () => {
    appState.values.set("content-trash", { operationIds: ["operation-old"] });

    await expect(loadTrashPurgeStarts()).resolves.toEqual([
      purgeStart({
        spaceId: null,
        planId: null,
        idempotencyKey: null,
        status: "started",
        operationId: "operation-old",
        input: null,
      }),
    ]);
    expect(appState.values.get(TRASH_PURGES_STATE_KEY)).toMatchObject({
      operationIds: ["operation-old"],
    });

    appState.values.set("content-trash", { operationIds: ["operation-gone"] });
    await expect(readTrashPurgeStarts()).resolves.toMatchObject([
      { operationId: "operation-old" },
    ]);
  });

  it("keeps a recovered start unresolved until the server settles it", () => {
    const start = purgeStart({ status: "unknown" });
    const messages = { expired: "expired", unknown: "unknown" };

    expect(
      trashPurgeRecoveryAfterError(
        start,
        { status: 409, errorCode: "start_pending" },
        messages,
      ),
    ).toMatchObject({ status: "unknown", idempotencyKey: "key-a" });
    expect(
      trashPurgeRecoveryAfterError(
        start,
        { status: 409, errorCode: "invalid_scope" },
        messages,
      ),
    ).toMatchObject({ status: "unknown" });
    expect(
      trashPurgeRecoveryAfterError(
        start,
        { status: 409, errorCode: "start_expired" },
        messages,
      ),
    ).toMatchObject({ status: "failed", error: "expired" });
    expect(
      trashPurgeRecoveryAfterError(
        start,
        { status: 409, details: { operationId: "operation-a" } },
        messages,
      ),
    ).toMatchObject({ status: "started", operationId: "operation-a" });
  });

  it("reloads saved starts, turning an interrupted one into unknown with its original key", async () => {
    appState.values.set(TRASH_PURGES_STATE_KEY, {
      purgeStarts: [
        purgeStart({ status: "starting" }),
        purgeStart({
          planId: "plan-b",
          status: "started",
          operationId: "operation-b",
        }),
      ],
    });

    await expect(readTrashPurgeStarts()).resolves.toEqual([
      purgeStart({ status: "unknown" }),
      purgeStart({
        planId: "plan-b",
        status: "started",
        operationId: "operation-b",
      }),
    ]);

    appState.values.set(TRASH_PURGES_STATE_KEY, {
      purgeStarts: [{ planId: "plan-a", status: "done" }],
    });
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
