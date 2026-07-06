import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory documentComments rows, keyed loosely like the real table.
type Row = {
  id: string;
  ownerEmail: string;
  documentId: string;
  threadId: string;
  parentId: string | null;
  content: string;
  authorEmail: string;
  authorName: string | null;
  notionCommentId: string | null;
  resolved: number;
};

const state = vi.hoisted(() => ({
  rows: [] as any[],
}));

const notionActionUtilsMocks = vi.hoisted(() => ({
  getNotionDocumentOwner: vi.fn(),
}));

const notionLibMocks = vi.hoisted(() => ({
  getNotionConnectionForOwner: vi.fn(),
  listNotionComments: vi.fn(),
  addNotionComment: vi.fn(),
}));

const notionSyncMocks = vi.hoisted(() => ({
  getSyncLink: vi.fn(),
}));

vi.mock("./_notion-action-utils.js", () => notionActionUtilsMocks);
vi.mock("../server/lib/notion.js", () => notionLibMocks);
vi.mock("../server/lib/notion-sync.js", () => notionSyncMocks);

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...conds: unknown[]) => ({ __and: conds }),
    eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
    isNull: (col: unknown) => ({ __isNull: col }),
  };
});

function matches(row: Row, cond: any): boolean {
  if (cond.__and) return cond.__and.every((c: any) => matches(row, c));
  if (cond.__eq) {
    const [col, value] = cond.__eq;
    const key = String(col).split(".").pop() as keyof Row;
    return row[key] === value;
  }
  if (cond.__isNull) {
    const key = String(cond.__isNull).split(".").pop() as keyof Row;
    return row[key] === null || row[key] === undefined;
  }
  return true;
}

vi.mock("../server/db/index.js", () => {
  const col = (table: string, name: string) => `${table}.${name}`;
  const schema = {
    documentComments: {
      id: col("documentComments", "id"),
      ownerEmail: col("documentComments", "ownerEmail"),
      documentId: col("documentComments", "documentId"),
      threadId: col("documentComments", "threadId"),
      parentId: col("documentComments", "parentId"),
      content: col("documentComments", "content"),
      authorEmail: col("documentComments", "authorEmail"),
      authorName: col("documentComments", "authorName"),
      notionCommentId: col("documentComments", "notionCommentId"),
      resolved: col("documentComments", "resolved"),
    },
  };

  const db = {
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: any) => {
          const matched = state.rows.filter((r) => matches(r, cond));
          const project = (row: Row) => {
            if (!projection) return row;
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(projection)) {
              out[key] = (row as any)[key];
            }
            return out;
          };
          const result: any = matched.map(project);
          result.limit = (_n: number) => matched.slice(0, _n).map(project);
          return result;
        },
      }),
    }),
    insert: () => ({
      values: (row: Row) => {
        state.rows.push({ ...row });
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (cond: any) => {
          for (const row of state.rows) {
            if (matches(row, cond)) Object.assign(row, patch);
          }
          return Promise.resolve();
        },
      }),
    }),
  };

  return { getDb: () => db, schema };
});

import syncNotionComments from "./sync-notion-comments";

async function run(documentId: string) {
  return (syncNotionComments as any).run({ documentId });
}

beforeEach(() => {
  state.rows.length = 0;
  notionActionUtilsMocks.getNotionDocumentOwner.mockReset();
  notionLibMocks.getNotionConnectionForOwner.mockReset();
  notionLibMocks.listNotionComments.mockReset();
  notionLibMocks.addNotionComment.mockReset();
  notionSyncMocks.getSyncLink.mockReset();

  notionActionUtilsMocks.getNotionDocumentOwner.mockResolvedValue(
    "owner-a@example.com",
  );
  notionSyncMocks.getSyncLink.mockResolvedValue({
    remotePageId: "notion-page-1",
  });
  notionLibMocks.getNotionConnectionForOwner.mockResolvedValue({
    accessToken: "token",
  });
});

describe("sync-notion-comments", () => {
  it("resolves the sync link via the document owner, not the requester (n3)", async () => {
    notionLibMocks.listNotionComments.mockResolvedValue([]);

    await run("doc-1");

    expect(notionActionUtilsMocks.getNotionDocumentOwner).toHaveBeenCalledWith(
      "doc-1",
    );
    // getSyncLink must be scoped by the resolved document owner.
    expect(notionSyncMocks.getSyncLink).toHaveBeenCalledWith(
      "doc-1",
      "owner-a@example.com",
    );
  });

  it("scopes pull-dedup by documentId so a second document linked to the same Notion page still receives comments (n36)", async () => {
    // Simulate doc-x already synced against the same Notion page/comment.
    state.rows.push({
      id: "c-existing",
      ownerEmail: "owner-a@example.com",
      documentId: "doc-x",
      threadId: "c-existing",
      parentId: null,
      content: "hello",
      authorEmail: "notion@sync",
      authorName: "Notion",
      notionCommentId: "nc-1",
      resolved: 0,
    });

    notionLibMocks.listNotionComments.mockResolvedValue([
      {
        id: "nc-1",
        rich_text: [{ plain_text: "hello" }],
        created_time: "2026-01-01T00:00:00.000Z",
        created_by: { id: "u1" },
      },
    ]);

    const result = await run("doc-y");

    expect(result).toEqual({ pulled: 1, pushed: 0 });
    const docYRows = state.rows.filter((r) => r.documentId === "doc-y");
    expect(docYRows).toHaveLength(1);
    expect(docYRows[0].notionCommentId).toBe("nc-1");
  });

  it("does not re-pull a comment already recorded for the same document", async () => {
    state.rows.push({
      id: "c-existing",
      ownerEmail: "owner-a@example.com",
      documentId: "doc-1",
      threadId: "c-existing",
      parentId: null,
      content: "hello",
      authorEmail: "notion@sync",
      authorName: "Notion",
      notionCommentId: "nc-1",
      resolved: 0,
    });

    notionLibMocks.listNotionComments.mockResolvedValue([
      {
        id: "nc-1",
        rich_text: [{ plain_text: "hello" }],
        created_time: "2026-01-01T00:00:00.000Z",
        created_by: { id: "u1" },
      },
    ]);

    const result = await run("doc-1");

    expect(result).toEqual({ pulled: 0, pushed: 0 });
    expect(state.rows).toHaveLength(1);
  });
});
