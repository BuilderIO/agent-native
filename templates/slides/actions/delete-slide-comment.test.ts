import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  deckId: string;
  slideId: string;
  authorEmail: string;
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
    delete: () => ({
      where: (cond: any) => {
        state.rows = state.rows.filter((r) => !matches(r, cond));
        return Promise.resolve();
      },
    }),
  };

  return { getDb: () => db, schema };
});

import action from "./delete-slide-comment";

function run(args: { id: string; deckId?: string }) {
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
    },
    {
      id: "c-2",
      deckId: "deck-1",
      slideId: "slide-1",
      authorEmail: "other@example.com",
    },
  ];
});

describe("delete-slide-comment", () => {
  it("lets the author delete their own comment with only viewer access", async () => {
    const result = await run({ id: "c-1" });

    expect(result).toEqual({ ok: true });
    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(state.rows.map((r) => r.id)).toEqual(["c-2"]);
  });

  it("requires editor access to delete someone else's comment", async () => {
    await run({ id: "c-2" });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(state.rows.map((r) => r.id)).toEqual(["c-1"]);
  });

  it("propagates a Forbidden failure when the caller lacks the required role", async () => {
    mockGetUserEmail.mockReturnValue("outsider@example.com");
    mockAssertAccess.mockImplementation(() => {
      throw new Error("Forbidden");
    });

    await expect(run({ id: "c-2" })).rejects.toThrow("Forbidden");
    // Row is untouched since assertAccess rejected before the delete.
    expect(state.rows.map((r) => r.id)).toEqual(["c-1", "c-2"]);
  });

  it("throws when the comment does not exist", async () => {
    await expect(run({ id: "missing" })).rejects.toThrow("Comment not found");
  });
});
