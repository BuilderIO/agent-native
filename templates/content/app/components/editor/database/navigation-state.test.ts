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

  it("reports each tab's effective selected view independently", () => {
    const base = {
      document: { id: "database-document", title: "Database" },
      databaseId: "database",
      previewItem: null,
    };
    const editorial = databaseNavigationState({
      ...base,
      activeView: {
        id: "editorial",
        name: "Editorial",
        type: "table" as const,
      },
    });
    const numbers = databaseNavigationState({
      ...base,
      activeView: {
        id: "numbers",
        name: "Numbers",
        type: "table" as const,
      },
    });

    expect(editorial).toMatchObject({
      databaseViewId: "editorial",
      databaseViewName: "Editorial",
    });
    expect(numbers).toMatchObject({
      databaseViewId: "numbers",
      databaseViewName: "Numbers",
    });
  });
});
