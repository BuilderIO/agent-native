import { describe, expect, it } from "vitest";

import { databaseNavigationState } from "./navigation-state";

describe("database navigation column presentation", () => {
  it("exposes wrap overrides and preserves explicit unfreeze", () => {
    expect(
      databaseNavigationState({
        document: { id: "database-document", title: "Database" },
        databaseId: "database",
        activeView: {
          id: "table",
          name: "Table",
          type: "table",
          columnWrapOverrides: { name: true, status: false },
          frozenThroughColumnId: null,
        },
        previewItem: null,
        effectiveFrozenColumnIds: [],
      }),
    ).toMatchObject({
      databaseColumnWrapOverrides: { name: true, status: false },
      databaseFrozenThroughColumnId: null,
      databaseEffectiveFrozenColumnIds: [],
    });
  });
});
