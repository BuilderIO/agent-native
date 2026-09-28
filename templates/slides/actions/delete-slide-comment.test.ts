import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  deckId: string;
  slideId: string;
  authorEmail: string;
  threadId: string;
  parentId: string | null;
  createdAt?: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetUserEmail = vi.hoisted(() => vi.fn(() => "author@example.com"));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ __and: conds }),
  eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
  asc: (column: unknown) => ({ __asc: column }),
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
  const col = (name: string) => `slideComments.${name}`;
  const schema = {
    slideComments: {
      id: col("id"),
      deckId: col("deckId"),
      slideId: col("slideId"),
      authorEmail: col("authorEmail"),
      threadId: col("threadId"),
      parentId: col("parentId"),
      createdAt: col("createdAt"),
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
            for (const key of Object.keys(projection))
              out[key] = row[key as keyof Row];
            return out;
          };
          const limit = async (n: number) => matched.slice(0, n).map(project);
          const ordered = [...matched].sort(
            (left, right) =>
              String(left.createdAt ?? "").localeCompare(
                String(right.createdAt ?? ""),
              ) || left.id.localeCompare(right.id),
          );
          const orderedLimit = async (n: number) =>
            ordered.slice(0, n).map(project);
          const forUpdate = async () => ordered.map(project);
          return {
            limit,
            orderBy: () => ({ limit: orderedLimit, for: forUpdate }),
          };
        },
      }),
    }),
    delete: () => ({
      where: (cond: any) => {
        state.rows = state.rows.filter((r) => !matches(r, cond));
        return Promise.resolve();
      },
    }),
  };

  return {
    getDb: () => ({
      ...db,
      transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db),
    }),
    schema,
  };
});

import action from "./delete-slide-comment";

function run(args: { id: string; deckId: string }) {
  return (action as any).run(args);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUserEmail.mockReturnValue("author@example.com");
  state.rows = [
    {
      id: "c-1",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "author@example.com",
      threadId: "c-1",
      parentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c-2",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
      threadId: "c-1",
      parentId: "c-1",
      createdAt: "2026-01-01T00:01:00.000Z",
    },
    {
      id: "c-3",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
      threadId: "c-3",
      parentId: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ];
});

describe("delete-slide-comment", () => {
  it("lets the author delete their own comment with commenter access", async () => {
    const result = await run({ id: "c-1", deckId: "deck-1" });

    expect(result).toEqual({ ok: true });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      "commenter",
    );
    expect(state.rows.map((r) => r.id)).toEqual(["c-3"]);
  });

  it("requires editor access to delete someone else's comment", async () => {
    await run({ id: "c-3", deckId: "deck-1" });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2"]);
  });

  it("deletes only the selected reply and keeps the thread root", async () => {
    mockGetUserEmail.mockReturnValue("other@example.com");

    await run({ id: "c-2", deckId: "deck-1" });

    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-3"]);
  });

  it("deletes a root thread by parentage when its id differs from threadId", async () => {
    state.rows[0]!.threadId = "thread-root";
    state.rows[1]!.threadId = "thread-root";

    await run({ id: "c-1", deckId: "deck-1" });

    expect(state.rows.map((r) => r.id)).toEqual(["c-3"]);
  });

  it("deletes a legacy reply with a null parent without deleting its thread", async () => {
    state.rows.push({
      id: "legacy-reply",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
      threadId: "c-1",
      parentId: null,
      createdAt: "2026-01-01T00:02:00.000Z",
    });
    mockGetUserEmail.mockReturnValue("other@example.com");

    await run({ id: "legacy-reply", deckId: "deck-1" });

    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("propagates a Forbidden failure when the caller lacks the required role", async () => {
    mockGetUserEmail.mockReturnValue("outsider@example.com");
    mockAssertAccess.mockImplementation(() => {
      throw new Error("Forbidden");
    });

    await expect(run({ id: "c-3", deckId: "deck-1" })).rejects.toThrow(
      "Forbidden",
    );
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("throws when the comment does not exist", async () => {
    await expect(run({ id: "missing", deckId: "deck-1" })).rejects.toThrow(
      "Comment not found",
    );
  });

  it("does not find a comment outside the authorized deck", async () => {
    await expect(run({ id: "c-1", deckId: "deck-2" })).rejects.toThrow(
      "Comment not found",
    );
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-2",
      "commenter",
    );
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2", "c-3"]);
  });
});
