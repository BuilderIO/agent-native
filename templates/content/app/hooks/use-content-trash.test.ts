import type { ContentTrashItem } from "@shared/content-trash";
import { describe, expect, it } from "vitest";

import {
  clearTrashSelection,
  changeTrashSort,
  extendTrashSelection,
  loadedTrashSelection,
  nearestVisibleTrashRow,
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
  toggleVisibleTrashSelection,
  visibleTrashItems,
} from "./use-content-trash";

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
    expect(trashDeleteRequest(selection, items, ["space-a"])).toEqual({
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
    });
  });

  it("keeps matching filters server-backed, one plan per workspace", () => {
    const filters = { query: "draft", kind: "page" as const };
    const selection = { mode: "matching" as const, filters };

    expect(trashSelectionCount(selection)).toBeNull();
    expect(trashDeleteRequest(selection, [], ["space-a", "space-b"])).toEqual({
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
    });
    expect(
      trashDeleteRequest(
        { mode: "matching", filters: { ...filters, spaceId: "space-b" } },
        [],
        ["space-a", "space-b"],
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

  it("empties every workspace, one plan each, independent of filters", () => {
    expect(trashEmptyRequest(["space-a", "space-b"])).toEqual({
      kind: "empty",
      targets: [
        { spaceId: "space-a", input: { mode: "scope", spaceId: "space-a" } },
        { spaceId: "space-b", input: { mode: "scope", spaceId: "space-b" } },
      ],
    });
    expect(trashEmptyRequest([])).toEqual({
      kind: "empty",
      targets: [{ spaceId: null, input: { mode: "scope" } }],
    });
  });

  it("restores a root together with the rows trashed with it", () => {
    const items = [
      trashItem("grandchild", { trashRootId: "root" }),
      trashItem("own-root"),
      trashItem("child", { trashRootId: "root" }),
      trashItem("root"),
    ];

    expect([...restoredTrashItemIds(items, "root")].sort()).toEqual([
      "child",
      "grandchild",
      "root",
    ]);
    expect([...restoredTrashItemIds(items, "own-root")]).toEqual(["own-root"]);
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
