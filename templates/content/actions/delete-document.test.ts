import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_database-utils.js", () => ({
  deleteDatabaseDataForDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conds: unknown[]) => ({ __and: conds }),
    eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
  };
});

// Minimal schema stand-in: each table is identified by name so a fake db can
// record which table a delete/select targeted.
const { schema } = vi.hoisted(() => ({
  schema: {
    documents: {
      id: "documents.id",
      parentId: "documents.parentId",
      ownerEmail: "documents.ownerEmail",
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
  return true;
}

describe("deleteDocumentRecursive", () => {
  let deleteCalls: DeleteCall[];
  let selectRows: Record<string, Record<string, unknown>[]>;
  let db: any;

  beforeEach(() => {
    deleteCalls = [];
    selectRows = {
      documents: [],
    };

    db = {
      select: () => ({
        from: (table: Record<string, string>) => ({
          where: async (cond: any) => {
            const name = tableNameFor(Object.values(table)[0] as string);
            const rows = selectRows[name] ?? [];
            return rows.filter((row) => matches(row, cond));
          },
        }),
      }),
      delete: (table: Record<string, string>) => ({
        where: async (cond: any) => {
          const name = tableNameFor(Object.values(table)[0] as string);
          deleteCalls.push({ table: name, cond });
        },
      }),
    };
  });

  it("deletes document_comments rows for the document being deleted (n38)", async () => {
    await deleteDocumentRecursive(db, "doc-1", "owner-a@example.com");

    const commentDeletes = deleteCalls.filter(
      (c) => c.table === "documentComments",
    );
    expect(commentDeletes).toHaveLength(1);
    expect(commentDeletes[0].cond).toEqual({
      __and: [
        { __eq: [schema.documentComments.documentId, "doc-1"] },
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
      .map((c: any) => c.cond.__and[0].__eq[1]);
    expect(commentDeleteDocIds.sort()).toEqual(
      ["child-1", "child-2", "doc-1"].sort(),
    );
  });
});
