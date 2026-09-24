import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  deckId: string;
  slideId: string;
  threadId: string;
  parentId: string | null;
  content: string;
  quotedText: string | null;
  anchor: string | null;
  emojiReactionsJson: string;
  authorEmail: string;
  authorName: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "viewer@example.com",
}));

vi.mock("@agent-native/core/user-profile", () => ({
  resolveUserProfileName: (
    _email: string,
    storedName: string | null,
    profileName?: string,
  ) => profileName ?? storedName,
}));

vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: vi.fn(async () => new Map()),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ __and: conditions }),
  asc: (column: unknown) => ({ __asc: column }),
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
      slideId: column("slideId"),
      threadId: column("threadId"),
      parentId: column("parentId"),
      content: column("content"),
      quotedText: column("quotedText"),
      anchor: column("anchor"),
      emojiReactionsJson: column("emojiReactionsJson"),
      authorEmail: column("authorEmail"),
      authorName: column("authorName"),
      resolved: column("resolved"),
      createdAt: column("createdAt"),
      updatedAt: column("updatedAt"),
    },
  };
  const db = {
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (condition: unknown) => ({
          orderBy: (...orders: unknown[]) => {
            const matchingRows = () =>
              state.rows.filter((row) => matches(row, condition));
            const orderedRows = () =>
              [...matchingRows()].sort((left, right) => {
                for (const order of orders) {
                  const field = String((order as { __asc?: unknown }).__asc)
                    .split(".")
                    .pop() as keyof Row;
                  const comparison = String(left[field]).localeCompare(
                    String(right[field]),
                  );
                  if (comparison !== 0) return comparison;
                }
                return 0;
              });
            const project = (row: Row) => {
              if (!projection) return row;
              const result: Record<string, unknown> = {};
              for (const [key, selectedColumn] of Object.entries(projection)) {
                const field = String(selectedColumn)
                  .split(".")
                  .pop() as keyof Row;
                result[key] = row[field];
              }
              return result;
            };
            const page = (offset: number, limit?: number) =>
              orderedRows()
                .slice(offset, limit === undefined ? undefined : offset + limit)
                .map(project);
            return {
              limit: (count: number) => ({
                offset: async (offset: number) => page(offset, count),
              }),
              offset: async (offset: number) => page(offset),
            };
          },
        }),
      }),
    }),
  };

  return { getDb: () => db, schema };
});

import action from "./list-slide-comments";

beforeEach(() => {
  vi.resetAllMocks();
  state.rows = [
    {
      id: "comment-1",
      deckId: "deck-1",
      slideId: "slide-1",
      threadId: "thread-1",
      parentId: null,
      content: "Check this title",
      quotedText: "Title",
      anchor: JSON.stringify({
        x: 25,
        y: 35,
        objectId: "shape-1",
        objectX: 50,
        objectY: 10,
      }),
      emojiReactionsJson: JSON.stringify({ "👍": ["viewer@example.com"] }),
      authorEmail: "author@example.com",
      authorName: "Author",
      resolved: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "comment-2",
      deckId: "deck-1",
      slideId: "slide-2",
      threadId: "thread-2",
      parentId: null,
      content: "Check this chart",
      quotedText: null,
      anchor: null,
      emojiReactionsJson: "{}",
      authorEmail: "other@example.com",
      authorName: null,
      resolved: true,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ];
});

describe("list-slide-comments", () => {
  it("lists anchored comments for one slide with viewer reaction state", async () => {
    const result = await (action as any).run({
      deckId: "deck-1",
      slideId: "slide-1",
    });

    expect(mockAssertAccess).toHaveBeenCalledWith("deck", "deck-1", "viewer");
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      id: "comment-1",
      slide_id: "slide-1",
      anchor: {
        objectId: "shape-1",
        objectX: 50,
        objectY: 10,
      },
      reactions: [{ emoji: "👍", count: 1, reacted: true }],
    });
  });

  it("lists all deck comments when no slide is selected", async () => {
    const result = await (action as any).run({ deckId: "deck-1" });

    expect(result.comments.map((comment: any) => comment.id)).toEqual([
      "comment-1",
      "comment-2",
    ]);
    expect(result).toMatchObject({
      has_more: false,
      next_offset: null,
      limit: 100,
      offset: 0,
    });
  });

  it("bounds the default page and exposes continuation metadata", async () => {
    state.rows = Array.from({ length: 201 }, (_, index) => ({
      ...state.rows[0]!,
      id: `comment-${index}`,
      slideId: `slide-${index}`,
      threadId: `thread-${index}`,
      createdAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));

    const result = await (action as any).run({ deckId: "deck-1" });

    expect(result.comments).toHaveLength(100);
    expect(result).toMatchObject({
      has_more: true,
      next_offset: 100,
      limit: 100,
      offset: 0,
    });
  });

  it("paginates when a bounded page size is requested", async () => {
    const result = await (action as any).run({
      deckId: "deck-1",
      limit: 1,
      offset: 0,
    });

    expect(result.comments.map((comment: any) => comment.id)).toEqual([
      "comment-1",
    ]);
    expect(result).toMatchObject({
      has_more: true,
      next_offset: 1,
      limit: 1,
      offset: 0,
    });
  });

  it("uses the comment ID as a stable tie-breaker for paging", async () => {
    state.rows = [
      {
        ...state.rows[0]!,
        id: "comment-b",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        ...state.rows[0]!,
        id: "comment-a",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const firstPage = await (action as any).run({
      deckId: "deck-1",
      limit: 1,
      offset: 0,
    });
    const secondPage = await (action as any).run({
      deckId: "deck-1",
      limit: 1,
      offset: 1,
    });

    expect(firstPage.comments.map((comment: any) => comment.id)).toEqual([
      "comment-a",
    ]);
    expect(secondPage.comments.map((comment: any) => comment.id)).toEqual([
      "comment-b",
    ]);
  });
});
