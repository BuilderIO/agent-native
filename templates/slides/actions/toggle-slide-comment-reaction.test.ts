import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  deckId: string;
  emojiReactionsJson: string;
  updatedAt: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetUserEmail = vi.hoisted(() =>
  vi.fn<() => string | undefined>(() => "viewer@example.com"),
);

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ __and: conditions }),
  eq: (column: unknown, value: unknown) => ({ __eq: [column, value] }),
}));

function matches(row: Row, condition: any): boolean {
  if (condition.__and) {
    return condition.__and.every((child: any) => matches(row, child));
  }
  if (condition.__eq) {
    const [column, value] = condition.__eq;
    const key = String(column).split(".").pop() as keyof Row;
    return row[key] === value;
  }
  return true;
}

vi.mock("../server/db/index.js", () => {
  const column = (name: string) => `slideComments.${name}`;
  const schema = {
    slideComments: {
      id: column("id"),
      deckId: column("deckId"),
      emojiReactionsJson: column("emojiReactionsJson"),
      updatedAt: column("updatedAt"),
    },
  };
  const db = {
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: async (count: number) =>
            state.rows
              .filter((row) => matches(row, condition))
              .slice(0, count)
              .map((row) => {
                if (!projection) return row;
                const result: Record<string, unknown> = {};
                for (const [key, selectedColumn] of Object.entries(
                  projection,
                )) {
                  const field = String(selectedColumn)
                    .split(".")
                    .pop() as keyof Row;
                  result[key] = row[field];
                }
                return result;
              }),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            const updated = state.rows.filter((row) => matches(row, condition));
            for (const row of updated) Object.assign(row, patch);
            return updated.map((row) => ({ id: row.id }));
          },
        }),
      }),
    }),
  };

  return { getDb: () => db, schema };
});

import action from "./toggle-slide-comment-reaction";

function run(args: { commentId: string; deckId: string; emoji: string }) {
  return (action as any).run(args);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUserEmail.mockReturnValue("viewer@example.com");
  state.rows = [
    {
      id: "comment-1",
      deckId: "deck-1",
      emojiReactionsJson: JSON.stringify({ "👍": ["other@example.com"] }),
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
});

describe("toggle-slide-comment-reaction", () => {
  it("adds a reaction with commenter access and returns viewer state", async () => {
    const result = await run({
      commentId: "comment-1",
      deckId: "deck-1",
      emoji: " 👍 ",
    });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      "commenter",
    );
    expect(result).toMatchObject({
      id: "comment-1",
      emoji: "👍",
      reacted: true,
    });
    expect(result.reactions).toEqual([
      { emoji: "👍", count: 2, reacted: true },
    ]);
  });

  it("removes the current user's existing reaction on the second toggle", async () => {
    state.rows[0]!.emojiReactionsJson = JSON.stringify({
      "🎉": ["viewer@example.com"],
    });

    const result = await run({
      commentId: "comment-1",
      deckId: "deck-1",
      emoji: "🎉",
    });

    expect(result).toMatchObject({
      id: "comment-1",
      emoji: "🎉",
      reacted: false,
      reactions: [],
    });
    expect(state.rows[0]!.emojiReactionsJson).toBe("{}");
  });

  it("does not expose or mutate a comment outside the requested deck", async () => {
    await expect(
      run({ commentId: "comment-1", deckId: "deck-2", emoji: "👍" }),
    ).rejects.toThrow("Comment not found");
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-2",
      "commenter",
    );
    expect(state.rows[0]!.emojiReactionsJson).toContain("other@example.com");
  });

  it("requires an authenticated user", async () => {
    mockGetUserEmail.mockReturnValue(undefined);

    await expect(
      run({ commentId: "comment-1", deckId: "deck-1", emoji: "👍" }),
    ).rejects.toThrow("Sign in required");
    expect(mockAssertAccess).not.toHaveBeenCalled();
  });
});
