import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conds: unknown[]) => ({ __and: conds }),
    eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
    inArray: (col: unknown, values: unknown[]) => ({
      __inArray: [col, values],
    }),
  };
});

const mutationLock = vi.hoisted(() => vi.fn());
const membershipLock = vi.hoisted(() => vi.fn());

vi.mock("./_content-database-mutation-lock.js", () => ({
  lockContentDatabaseMutation: mutationLock,
  touchContentDatabase: vi.fn(),
}));

vi.mock("./_database-membership-lock.js", () => ({
  lockDatabaseMemberships: membershipLock,
}));

// Minimal schema stand-in: each table is identified by name so a fake db can
// record which table a delete/select targeted.
const { schema } = vi.hoisted(() => ({
  schema: {
    documents: {
      id: "documents.id",
      parentId: "documents.parentId",
      ownerEmail: "documents.ownerEmail",
    },
    contentDatabases: {
      id: "contentDatabases.id",
      documentId: "contentDatabases.documentId",
      ownerEmail: "contentDatabases.ownerEmail",
    },
    contentDatabaseItems: {
      id: "contentDatabaseItems.id",
      databaseId: "contentDatabaseItems.databaseId",
      documentId: "contentDatabaseItems.documentId",
      ownerEmail: "contentDatabaseItems.ownerEmail",
    },
    contentDatabaseItemKeyClaims: {
      databaseId: "contentDatabaseItemKeyClaims.databaseId",
      documentId: "contentDatabaseItemKeyClaims.documentId",
    },
    contentSpaceCatalogItems: {
      id: "contentSpaceCatalogItems.id",
      documentId: "contentSpaceCatalogItems.documentId",
    },
    documentPropertyDefinitions: {
      id: "documentPropertyDefinitions.id",
      databaseId: "documentPropertyDefinitions.databaseId",
    },
    contentDatabaseSources: {
      id: "contentDatabaseSources.id",
      databaseId: "contentDatabaseSources.databaseId",
    },
    contentDatabaseBodyHydrationQueue: {
      sourceId: "contentDatabaseBodyHydrationQueue.sourceId",
      documentId: "contentDatabaseBodyHydrationQueue.documentId",
    },
    contentDatabaseSourceExecutions: {
      sourceId: "contentDatabaseSourceExecutions.sourceId",
    },
    contentDatabaseSourceChangeReviews: {
      sourceId: "contentDatabaseSourceChangeReviews.sourceId",
    },
    contentDatabaseSourceChangeSets: {
      sourceId: "contentDatabaseSourceChangeSets.sourceId",
    },
    contentDatabaseSourceRows: {
      sourceId: "contentDatabaseSourceRows.sourceId",
    },
    contentDatabaseSourceFields: {
      sourceId: "contentDatabaseSourceFields.sourceId",
    },
    documentPropertyValues: {
      propertyId: "documentPropertyValues.propertyId",
      documentId: "documentPropertyValues.documentId",
      ownerEmail: "documentPropertyValues.ownerEmail",
    },
    documentBlockFieldContents: {
      propertyId: "documentBlockFieldContents.propertyId",
      documentId: "documentBlockFieldContents.documentId",
    },
    documentBlockFields: {
      id: "documentBlockFields.id",
      documentId: "documentBlockFields.documentId",
      propertyId: "documentBlockFields.propertyId",
    },
    documentBlocks: {
      fieldId: "documentBlocks.fieldId",
    },
    documentSyncLinks: {
      documentId: "documentSyncLinks.documentId",
      ownerEmail: "documentSyncLinks.ownerEmail",
    },
    documentVersions: {
      documentId: "documentVersions.documentId",
      ownerEmail: "documentVersions.ownerEmail",
    },
    builderDocSidecars: {
      documentId: "builderDocSidecars.documentId",
      ownerEmail: "builderDocSidecars.ownerEmail",
    },
    documentComments: {
      documentId: "documentComments.documentId",
      ownerEmail: "documentComments.ownerEmail",
    },
    documentShares: { resourceId: "documentShares.resourceId" },
    contentDatabaseMigrationReceipts: {
      databaseId: "contentDatabaseMigrationReceipts.databaseId",
    },
  },
}));

vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema,
}));

import { deleteDocumentRecursive } from "./delete-document";

type DeleteCall = { table: string; cond: unknown };

function tableNameFor(colRef: string): string {
  return colRef.split(".")[0];
}

function matches(row: Record<string, unknown>, cond: any): boolean {
  if (cond.__and) return cond.__and.every((c: any) => matches(row, c));
  if (cond.__eq) {
    const [col, value] = cond.__eq;
    const key = String(col).split(".").pop() as string;
    return row[key] === value;
  }
  if (cond.__inArray) {
    const [col, values] = cond.__inArray;
    const key = String(col).split(".").pop() as string;
    return values.includes(row[key]);
  }
  return true;
}

describe("deleteDocumentRecursive", () => {
  let deleteCalls: DeleteCall[];
  let selectRows: Record<string, Record<string, unknown>[]>;
  let db: any;
  let transactionDepth: number;
  let operationsOutsideTransaction: string[];

  beforeEach(() => {
    mutationLock.mockReset();
    membershipLock.mockReset();
    deleteCalls = [];
    selectRows = {
      documents: [],
    };
    transactionDepth = 0;
    operationsOutsideTransaction = [];

    db = {
      select: () => ({
        from: (table: Record<string, string>) => ({
          where: async (cond: any) => {
            const name = tableNameFor(Object.values(table)[0] as string);
            if (transactionDepth === 0)
              operationsOutsideTransaction.push(`select:${name}`);
            const rows = selectRows[name] ?? [];
            return rows.filter((row) => matches(row, cond));
          },
        }),
      }),
      delete: (table: Record<string, string>) => ({
        where: async (cond: any) => {
          const name = tableNameFor(Object.values(table)[0] as string);
          if (transactionDepth === 0)
            operationsOutsideTransaction.push(`delete:${name}`);
          deleteCalls.push({ table: name, cond });
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => [],
        }),
      }),
      transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        transactionDepth += 1;
        try {
          return await run(db);
        } finally {
          transactionDepth -= 1;
        }
      },
    };
  });

  it("keeps lock, final recollection, and cleanup on one transaction handle", async () => {
    await deleteDocumentRecursive(db, "doc-1", "owner-a@example.com");

    expect(operationsOutsideTransaction).toEqual([]);
    expect(transactionDepth).toBe(0);
  });

  it("locks a row document's parent database without deleting that database", async () => {
    selectRows.contentDatabaseItems = [
      {
        id: "row-membership",
        databaseId: "parent-database",
        documentId: "row-document",
        ownerEmail: "owner-a@example.com",
      },
    ];
    selectRows.contentDatabases = [
      {
        id: "parent-database",
        documentId: "parent-database-document",
        ownerEmail: "owner-a@example.com",
      },
    ];
    await deleteDocumentRecursive(db, "row-document", "owner-a@example.com");

    expect(mutationLock).toHaveBeenCalledWith(db, "parent-database");
    const parentDatabaseDeletes = deleteCalls.filter(
      (call) => call.table === "contentDatabases",
    );
    expect(parentDatabaseDeletes).toEqual([]);
  });

  it("deletes document_comments rows for the document being deleted (n38)", async () => {
    await deleteDocumentRecursive(db, "doc-1", "owner-a@example.com");

    const commentDeletes = deleteCalls.filter(
      (c) => c.table === "documentComments",
    );
    expect(commentDeletes).toHaveLength(1);
    expect(commentDeletes[0].cond).toEqual({
      __and: [
        { __inArray: [schema.documentComments.documentId, ["doc-1"]] },
        { __eq: [schema.documentComments.ownerEmail, "owner-a@example.com"] },
      ],
    });
  });

  it("deletes document_comments for every recursively deleted child", async () => {
    selectRows.documents = [
      { id: "child-1", parentId: "doc-1", ownerEmail: "owner-a@example.com" },
      { id: "child-2", parentId: "doc-1", ownerEmail: "owner-a@example.com" },
    ];

    const deleted = await deleteDocumentRecursive(
      db,
      "doc-1",
      "owner-a@example.com",
    );

    expect(deleted.sort()).toEqual(["child-1", "child-2", "doc-1"].sort());
    const commentDeleteDocIds = deleteCalls
      .filter((c) => c.table === "documentComments")
      .flatMap((c: any) => c.cond.__and[0].__inArray[1]);
    expect(commentDeleteDocIds.sort()).toEqual(
      ["child-1", "child-2", "doc-1"].sort(),
    );
  });

  it("includes database item pages in one recursive delete pass", async () => {
    selectRows.contentDatabases = [
      {
        id: "database-1",
        documentId: "database-doc",
        ownerEmail: "owner-a@example.com",
      },
    ];
    selectRows.contentDatabaseItems = [
      {
        id: "membership-1",
        databaseId: "database-1",
        documentId: "row-doc-1",
        ownerEmail: "owner-a@example.com",
      },
      {
        id: "membership-2",
        databaseId: "database-1",
        documentId: "row-doc-2",
        ownerEmail: "owner-a@example.com",
      },
    ];
    selectRows.documents = [
      { id: "row-doc-1", ownerEmail: "owner-a@example.com" },
      { id: "row-doc-2", ownerEmail: "owner-a@example.com" },
    ];

    const deleted = await deleteDocumentRecursive(
      db,
      "database-doc",
      "owner-a@example.com",
    );

    expect(deleted.sort()).toEqual(
      ["database-doc", "row-doc-1", "row-doc-2"].sort(),
    );

    const membershipDeletes = deleteCalls.filter(
      (c) =>
        c.table === "contentDatabaseItems" &&
        c.cond.__inArray?.[0] === schema.contentDatabaseItems.databaseId,
    );
    expect(membershipDeletes).toHaveLength(1);
    expect(membershipDeletes[0].cond).toEqual({
      __inArray: [schema.contentDatabaseItems.databaseId, ["database-1"]],
    });
    expect(mutationLock).toHaveBeenCalledWith(db, "database-1");
    expect(membershipLock).toHaveBeenCalledWith(
      db,
      expect.arrayContaining(["membership-1", "membership-2"]),
    );
  });

  it("recollects database rows after acquiring the permanent-cleanup lock", async () => {
    selectRows.contentDatabases = [
      {
        id: "database-1",
        documentId: "database-doc",
        ownerEmail: "owner-a@example.com",
      },
    ];
    selectRows.contentDatabaseItems = [
      {
        databaseId: "database-1",
        documentId: "row-doc-1",
        ownerEmail: "owner-a@example.com",
      },
    ];
    selectRows.documents = [
      { id: "row-doc-1", ownerEmail: "owner-a@example.com" },
    ];
    mutationLock.mockImplementationOnce(async () => {
      selectRows.contentDatabaseItems.push({
        databaseId: "database-1",
        documentId: "late-row-doc",
        ownerEmail: "owner-a@example.com",
      });
      selectRows.documents.push({
        id: "late-row-doc",
        ownerEmail: "owner-a@example.com",
      });
    });

    const deleted = await deleteDocumentRecursive(
      db,
      "database-doc",
      "owner-a@example.com",
    );

    expect(deleted.sort()).toEqual(
      ["database-doc", "late-row-doc", "row-doc-1"].sort(),
    );
    expect(operationsOutsideTransaction).toEqual([]);
  });

  it("does not collect foreign-owned database item documents", async () => {
    selectRows.contentDatabases = [
      {
        id: "database-1",
        documentId: "database-doc",
        ownerEmail: "owner-a@example.com",
      },
    ];
    selectRows.contentDatabaseItems = [
      {
        id: "membership-1",
        databaseId: "database-1",
        documentId: "row-doc-1",
        ownerEmail: "owner-a@example.com",
      },
      {
        id: "membership-foreign",
        databaseId: "database-1",
        documentId: "foreign-row-doc",
        ownerEmail: "owner-b@example.com",
      },
      {
        id: "membership-mismatched",
        databaseId: "database-1",
        documentId: "mismatched-row-doc",
        ownerEmail: "owner-a@example.com",
      },
    ];
    selectRows.documents = [
      { id: "row-doc-1", ownerEmail: "owner-a@example.com" },
      { id: "foreign-row-doc", ownerEmail: "owner-b@example.com" },
      { id: "mismatched-row-doc", ownerEmail: "owner-b@example.com" },
    ];

    const deleted = await deleteDocumentRecursive(
      db,
      "database-doc",
      "owner-a@example.com",
    );

    expect(deleted.sort()).toEqual(["database-doc", "row-doc-1"].sort());
  });

  it("chunks the final documents delete", async () => {
    selectRows.documents = Array.from({ length: 95 }, (_, index) => ({
      id: `child-${index}`,
      parentId: "doc-1",
      ownerEmail: "owner-a@example.com",
    }));

    await deleteDocumentRecursive(db, "doc-1", "owner-a@example.com");

    const documentDeletes = deleteCalls.filter((c) => c.table === "documents");
    expect(documentDeletes).toHaveLength(2);
    expect(
      documentDeletes.map((c: any) => c.cond.__and[0].__inArray[1].length),
    ).toEqual([90, 6]);
  });
});
