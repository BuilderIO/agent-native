import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("bounded Content navigation reads", () => {
  it("filters Favorites access inside the membership query", () => {
    const databaseUtils = source("./_database-utils.ts");

    expect(databaseUtils).toContain("favoritesVisibleDocumentQuery");
    expect(databaseUtils).toContain(
      "inArray(\n          schema.contentDatabaseItems.documentId,\n          favoritesVisibleDocumentQuery",
    );
    expect(databaseUtils).not.toContain("favoritesVisibleDocumentIds");
  });

  it("caps active ancestry and returns explicit workspace metadata", () => {
    const action = source("./get-content-navigation-context.ts");

    expect(action).toContain("const MAX_ANCESTORS = 100");
    expect(action).toContain("workspaceFilesDatabaseId");
    expect(action).not.toContain("listLocalFileDocuments");
  });

  it("returns an explicit active navigation outcome after deletion", () => {
    const action = source("./delete-document.ts");

    expect(action).toContain("activeTargetDeleted");
    expect(action).toContain("navigationPath:");
    expect(action).toContain('? "/home"');
  });
});
