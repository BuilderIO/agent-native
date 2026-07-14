import { beforeEach, describe, expect, it, vi } from "vitest";

// Same in-memory row-matching approach as update-comment.test.ts, applied to
// the REST route directly, so this proves the route's permission/behavior
// for resolve+reopen match the update-comment action, not just that they
// happen to read the same way.
type Row = {
  id: string;
  documentId: string;
  threadId: string;
  parentId: string | null;
  content: string;
  authorEmail: string;
  resolved: number;
  updatedAt: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

const { MockForbiddenError } = vi.hoisted(() => {
  class MockForbiddenError extends Error {
    statusCode = 403;
  }
  return { MockForbiddenError };
});

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  readBody: (...args: unknown[]) => mockReadBody(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
  ForbiddenError: MockForbiddenError,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ __and: conds }),
  eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

function matches(row: Row, cond: any): boolean {
  if (cond.__and) return cond.__and.every((c: any) => matches(row, c));
  if (cond.__eq) {
    const [col, value] = cond.__eq;
    const key = String(col).split(".").pop() as keyof Row;
    return row[key] === value;
  }
  return true;
}

vi.mock("../../../db/index.js", () => {
  const col = (name: string) => `documentComments.${name}`;
  const schema = {
    documentComments: {
      id: col("id"),
      documentId: col("documentId"),
      threadId: col("threadId"),
      parentId: col("parentId"),
      content: col("content"),
      authorEmail: col("authorEmail"),
      resolved: col("resolved"),
      updatedAt: col("updatedAt"),
    },
  };

  const db = {
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: any) => ({
          limit: async (n: number) => {
            const matched = state.rows.filter((r) => matches(r, cond));
            const project = (row: Row) => {
              if (!projection) return row;
              const out: Record<string, unknown> = {};
              for (const key of Object.keys(projection)) {
                out[key] = (row as any)[key];
              }
              return out;
            };
            return matched.slice(0, n).map(project);
          },
        }),
      }),
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

import handler from "./[id].patch";

beforeEach(() => {
  vi.resetAllMocks();
  state.rows = [
    {
      id: "c-1",
      documentId: "doc-1",
      threadId: "c-1",
      parentId: null,
      content: "Original text",
      authorEmail: "author@example.com",
      resolved: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c-2",
      documentId: "doc-1",
      threadId: "c-1",
      parentId: "c-1",
      content: "A reply",
      authorEmail: "other@example.com",
      resolved: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  mockGetRouterParam.mockReturnValue("c-1");
  mockGetSession.mockResolvedValue({
    email: "author@example.com",
    orgId: "org-1",
  });
  mockRunWithRequestContext.mockImplementation(
    (_ctx: unknown, fn: () => unknown) => fn(),
  );
});

describe("PATCH /api/comments/:id (content) — reopen permission parity", () => {
  it("requires editor access to reopen a thread, even for the comment's own author", async () => {
    mockReadBody.mockResolvedValue({ resolved: false });

    const result = await handler({} as any);

    // This is the FIX 2 regression guard: before the fix, the route allowed
    // the author to reopen with only viewer access, diverging from the
    // update-comment action, which always requires editor for resolve/reopen.
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(result).toEqual({ ok: true, resolved: false });
    expect(state.rows[0].resolved).toBe(0);
    expect(state.rows[1].resolved).toBe(0); // whole thread reopened, not just c-1
  });

  it("rejects reopening for a caller with only viewer access", async () => {
    mockReadBody.mockResolvedValue({ resolved: false });
    mockAssertAccess.mockImplementation(
      (_type: string, _id: string, role: string) => {
        if (role === "editor") throw new MockForbiddenError("Forbidden");
      },
    );

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({ error: "Comment not found" });
    // Row untouched since assertAccess rejected before the update.
    expect(state.rows[0].resolved).toBe(1);
  });

  it("requires editor access to resolve a thread", async () => {
    mockReadBody.mockResolvedValue({ resolved: true });

    await handler({} as any);

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
  });

  it("allows the author to edit their own comment content with only viewer access", async () => {
    mockReadBody.mockResolvedValue({ content: "Updated text" });

    const result = await handler({} as any);

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "viewer",
    );
    expect(result).toEqual({ ok: true });
    expect(state.rows[0].content).toBe("Updated text");
  });
});
