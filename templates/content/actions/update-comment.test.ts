import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory documentComments rows, filtered by mocked and()/eq() conditions —
// same pattern as sync-notion-comments.test.ts, chosen so thread-wide
// resolve/reopen updates (which touch multiple rows) are exercised for real.
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
const mockGetUserEmail = vi.hoisted(() => vi.fn(() => "author@example.com"));
const mockWriteAppState = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
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

vi.mock("../server/db/index.js", () => {
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

import action from "./update-comment";

function run(args: {
  id: string;
  documentId?: string;
  content?: string;
  resolved?: boolean;
}) {
  return (action as any).run(args);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUserEmail.mockReturnValue("author@example.com");
  state.rows = [
    {
      id: "c-1",
      documentId: "doc-1",
      threadId: "c-1",
      parentId: null,
      content: "Original text",
      authorEmail: "author@example.com",
      resolved: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c-2",
      documentId: "doc-1",
      threadId: "c-1",
      parentId: "c-1",
      content: "A reply",
      authorEmail: "other@example.com",
      resolved: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
});

describe("update-comment (action) — reopen permission", () => {
  it("requires editor access to reopen a thread, even for the comment's own author", async () => {
    state.rows.forEach((r) => (r.resolved = 1));
    mockGetUserEmail.mockReturnValue("author@example.com");

    const result = await run({ id: "c-1", resolved: false });

    expect(result).toEqual({ ok: true, resolved: false });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(state.rows[0].resolved).toBe(0);
    expect(state.rows[1].resolved).toBe(0); // whole thread reopened
  });

  it("requires editor access to resolve a thread", async () => {
    const result = await run({ id: "c-1", resolved: true });

    expect(result).toEqual({ ok: true, resolved: true });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
    );
    expect(state.rows[1].resolved).toBe(1); // whole thread resolved
  });

  it("allows the author to edit their own comment content with only viewer access", async () => {
    const result = await run({ id: "c-1", content: "Updated" });

    expect(result).toEqual({ ok: true });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "viewer",
    );
  });
});
