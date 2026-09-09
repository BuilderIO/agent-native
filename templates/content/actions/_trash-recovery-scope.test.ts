import { describe, expect, it } from "vitest";

import {
  selectedTrashSubtree,
  trashScopeToken,
  type TrashRecoveryDocument,
} from "./_trash-recovery-scope.js";

function document(
  id: string,
  parentId: string | null,
  trashRootId: string | null = "root",
): TrashRecoveryDocument {
  return {
    id,
    parentId,
    trashRootId,
    trashedAt: trashRootId ? "2026-09-09T12:00:00Z" : null,
    ownerEmail: "owner@example.com",
    spaceId: "space",
    orgId: "org",
    visibility: "private",
  };
}

describe("selected Trash subtree", () => {
  it("recovers a child's original group descendants without its parent or independently deleted children", () => {
    const rows = [
      document("root", null),
      document("child", "root"),
      document("grandchild", "child"),
      document("separate", "child", "separate"),
      document("live", "child", null),
    ];
    expect(selectedTrashSubtree(rows, "child").map((row) => row.id)).toEqual([
      "child",
      "grandchild",
    ]);
  });
  it("excludes recovered detached children from a later parent operation", () => {
    expect(
      selectedTrashSubtree(
        [document("root", null), document("child", null, null)],
        "root",
      ).map((row) => row.id),
    ).toEqual(["root"]);
  });
  it("binds confirmation to scope and access metadata, independent of row order", () => {
    const rows = [document("root", null), document("child", "root")];
    expect(trashScopeToken(rows)).toBe(trashScopeToken([...rows].reverse()));
    expect(trashScopeToken(rows)).not.toBe(trashScopeToken([rows[0]]));
    expect(trashScopeToken(rows)).not.toBe(
      trashScopeToken([rows[0], { ...rows[1], visibility: "public" }]),
    );
  });
});
