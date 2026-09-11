import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const rowActionSources = [
  new URL("./DatabaseView.tsx", import.meta.url),
  new URL("./shared.tsx", import.meta.url),
];

describe("database row action system-removal wiring", () => {
  for (const sourceUrl of rowActionSources) {
    it(`passes the database system role into ${sourceUrl.pathname.split("/").slice(-1)[0]}`, () => {
      const source = readFileSync(sourceUrl, "utf8");

      expect(source).toContain(
        "databaseSystemRole: databaseData.database.systemRole",
      );
      expect(source).toContain(
        "canRemoveFromDatabase || canDeleteWorkspace ? (",
      );
      expect(source).toContain('dbText("removeFromDatabase")');
      expect(source).toContain("removesFavoriteMembership");
      expect(source).toContain(
        "databaseItemCanDuplicate(item, isWorkspaceCatalog)",
      );
      expect(source).toContain("{canDuplicateRow ? (");
      expect(source).toContain("<IconStarOff");
    });
  }

  it("keeps the table scroll surface keyboard reachable", () => {
    const source = readFileSync(rowActionSources[0], "utf8");

    expect(source).toContain('data-database-scroll-surface="table"');
    expect(source).toContain("tabIndex={0}");
  });
});
