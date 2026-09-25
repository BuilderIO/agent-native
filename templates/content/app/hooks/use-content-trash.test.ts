import { describe, expect, it } from "vitest";

import {
  clearTrashSelection,
  changeTrashSort,
  extendTrashSelection,
  loadedTrashSelection,
  nearestVisibleTrashRow,
  reconcileTrashBrowseFilters,
  selectedTrashItems,
  trashSelectionCount,
  trashSelectionPlanInput,
  trashScopePlanInput,
  trashSelectionState,
  trashMatchingFilters,
  trashFilterMembershipKey,
  trashOperationIdFromError,
  toggleVisibleTrashSelection,
  visibleTrashItems,
} from "./use-content-trash";

describe("Trash selection", () => {
  it("deduplicates loaded IDs and plans an explicit selection", () => {
    const selection = loadedTrashSelection(["a", "b", "a"]);

    expect(trashSelectionCount(selection)).toBe(2);
    expect(trashSelectionPlanInput(selection)).toEqual({
      mode: "selection",
      documentIds: ["a", "b"],
    });
  });

  it("keeps matching filters server-backed", () => {
    const filters = { query: "draft", kind: "page" as const };
    const selection = { mode: "matching" as const, filters };

    expect(trashSelectionCount(selection)).toBeNull();
    expect(trashSelectionPlanInput(selection)).toEqual({
      mode: "matching",
      filters,
    });
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

  it("keeps Empty Trash independent from browser filters", () => {
    expect(trashScopePlanInput("space-1")).toEqual({
      mode: "scope",
      spaceId: "space-1",
    });
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
