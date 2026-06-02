import { describe, expect, it } from "vitest";
import { filterDatabaseContainedDocuments } from "./_database-utils";

function doc(id: string, parentId: string | null = null) {
  return { id, parentId };
}

describe("filterDatabaseContainedDocuments", () => {
  it("keeps database pages while omitting their row pages", () => {
    expect(
      filterDatabaseContainedDocuments(
        [doc("database"), doc("row", "database")],
        ["row"],
      ).map((item) => item.id),
    ).toEqual(["database"]);
  });

  it("omits descendants of database row pages from ordinary trees", () => {
    expect(
      filterDatabaseContainedDocuments(
        [
          doc("database"),
          doc("row", "database"),
          doc("row-child", "row"),
          doc("ordinary"),
        ],
        ["row"],
      ).map((item) => item.id),
    ).toEqual(["database", "ordinary"]);
  });
});
