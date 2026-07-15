import { describe, expect, it } from "vitest";

import {
  contentDatabaseListDocumentSelection,
  filterContentDatabaseSourceRowsForPage,
  filterDatabaseContainedDocuments,
} from "./_database-utils";

describe("content database list projections", () => {
  it("does not select document bodies for table rows", () => {
    expect(contentDatabaseListDocumentSelection).not.toHaveProperty("content");
    expect(contentDatabaseListDocumentSelection).toMatchObject({
      id: expect.anything(),
      title: expect.anything(),
      updatedAt: expect.anything(),
    });
  });
});

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

describe("filterContentDatabaseSourceRowsForPage", () => {
  it("retains an off-page row when an actionable review references its identity", () => {
    const visibleRow = {
      documentId: "visible-document",
      databaseItemId: "visible-item",
      sourceRowId: "visible-target",
    };
    const reviewedRow = {
      documentId: "quiet-comet-document",
      databaseItemId: "quiet-comet-item",
      sourceRowId: "1ce2e96574be4b22baf1e11480520205",
    };
    const unrelatedRow = {
      documentId: "unrelated-document",
      databaseItemId: "unrelated-item",
      sourceRowId: "unrelated-target",
    };

    const rows = filterContentDatabaseSourceRowsForPage({
      rows: [visibleRow, reviewedRow, unrelatedRow],
      visibleDocumentIds: new Set([visibleRow.documentId]),
      changeSets: [
        {
          documentId: reviewedRow.documentId,
          databaseItemId: reviewedRow.databaseItemId,
          direction: "outbound",
          state: "pending_push",
          executions: [],
        },
      ],
    });

    expect(rows).toEqual([visibleRow, reviewedRow]);
  });

  it("does not retain off-page rows for completed reviews", () => {
    const completedRow = {
      documentId: "completed-document",
      databaseItemId: "completed-item",
    };

    expect(
      filterContentDatabaseSourceRowsForPage({
        rows: [completedRow],
        visibleDocumentIds: new Set(),
        changeSets: [
          {
            documentId: completedRow.documentId,
            databaseItemId: completedRow.databaseItemId,
            direction: "outbound",
            state: "approved",
            executions: [{ state: "succeeded" }],
          },
        ],
      }),
    ).toEqual([]);
  });
});
