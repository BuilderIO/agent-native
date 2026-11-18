import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  deckId: string;
  slideId: string;
  threadId: string;
  parentId: string | null;
  resolved: boolean;
};

const state = vi.hoisted(() => ({
  deckData: JSON.stringify({ slides: [{ id: "slide-1" }, { id: "slide-2" }] }),
  deckMissingAtLock: false,
  inserted: {} as Record<string, unknown>,
  rows: [] as Row[],
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: () => ({ browserTabId: "tab-1" }),
  getRequestUserEmail: () => "tiana@example.com",
  getRequestUserName: () => "Tiana",
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));
vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ __and: conds }),
  eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
}));
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDeckComment: vi.fn(async () => false),
}));
const mirror = vi.hoisted(() => ({
  comments: vi.fn(async (..._args: unknown[]) => undefined),
  deleted: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("@agent-native/core/review", () => ({
  ensureReviewTables: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/slide-comment-mirror.js", () => ({
  mirrorSlideComments: mirror.comments,
  deleteMirroredSlideComments: mirror.deleted,
}));
vi.mock("../server/db/index.js", () => {
  const col = (name: string) => `slideComments.${name}`;
  const schema = {
    decks: { id: "decks.id", data: "decks.data" },
    slideComments: {
      id: col("id"),
      deckId: col("deckId"),
      slideId: col("slideId"),
      threadId: col("threadId"),
      parentId: col("parentId"),
      resolved: col("resolved"),
    },
  };
  const matches = (row: Record<string, unknown>, cond: any): boolean => {
    if (cond.__and)
      return cond.__and.every((child: any) => matches(row, child));
    if (cond.__eq) {
      const [column, value] = cond.__eq;
      return row[String(column).split(".").pop()!] === value;
    }
    return true;
  };
  const db = {
    select: (projection?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (condition: any) => {
          const rows =
            table === schema.decks && !state.deckMissingAtLock
              ? [{ id: "deck-1", data: state.deckData }]
              : state.rows;
          const matchingRows = rows.filter((row) =>
            matches(row as Record<string, unknown>, condition),
          );
          const project = (row: unknown) => {
            if (!projection) return row;
            const result: Record<string, unknown> = {};
            for (const [key, column] of Object.entries(projection)) {
              result[key] =
                table === schema.decks
                  ? state.deckData
                  : (row as Record<string, unknown>)[
                      String(column).split(".").pop()!
                    ];
            }
            return result;
          };
          const limit = async (count: number) =>
            matchingRows.slice(0, count).map(project);
          return {
            limit,
            for: async () => matchingRows.map(project),
          };
        },
      }),
    }),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        state.inserted = value;
      },
    }),
  };
  return {
    schema,
    getDb: () => ({
      ...db,
      transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db),
    }),
  };
});

import action from "./add-slide-comment";

const run = (
  args: Record<string, unknown>,
  ctx: ActionRunContext = { caller: "frontend" },
) => (action as any).run(args, ctx);

beforeEach(() => {
  state.deckData = JSON.stringify({
    slides: [{ id: "slide-1" }, { id: "slide-2" }],
  });
  state.deckMissingAtLock = false;
  state.inserted = {};
  state.rows = [
    {
      id: "root-1",
      deckId: "deck-1",
      slideId: "slide-1",
      threadId: "thread-1",
      parentId: null,
      resolved: false,
    },
    {
      id: "reply-1",
      deckId: "deck-1",
      slideId: "slide-1",
      threadId: "thread-1",
      parentId: "root-1",
      resolved: false,
    },
  ];
});

describe("add-slide-comment", () => {
  it("announces its change to every collaborator on the deck", () => {
    expect((action as any).changeResource({ deckId: "deck-1" })).toEqual({
      resourceType: "deck",
      resourceId: "deck-1",
    });
  });

  it("keeps the authenticated profile name for frontend comments", async () => {
    await run({ deckId: "deck-1", slideId: "slide-1", content: "Looks good" });

    expect(state.inserted.authorName).toBe("Tiana");
    expect(state.inserted.parentId).toBeNull();
  });

  it("mirrors the new comment into the review kit after inserting, in the same transaction", async () => {
    mirror.comments.mockClear();
    let insertedFirst = false;
    mirror.comments.mockImplementationOnce(async () => {
      insertedFirst = state.inserted.content === "Same slide, new note";
    });

    const result = await run({
      deckId: "deck-1",
      slideId: "slide-1",
      content: "Same slide, new note",
    });

    expect(insertedFirst).toBe(true);
    expect(mirror.comments).toHaveBeenCalledWith(expect.anything(), "deck-1", [
      result.id,
    ]);
  });

  it("mirrors only the new reply, not the rest of its thread", async () => {
    mirror.comments.mockClear();

    const result = await run({
      deckId: "deck-1",
      slideId: "slide-1",
      content: "Agreed",
      threadId: "thread-1",
      parentId: "reply-1",
    });

    expect(mirror.comments).toHaveBeenCalledWith(expect.anything(), "deck-1", [
      result.id,
    ]);
  });

  it("labels agent tool comments separately", async () => {
    await run(
      { deckId: "deck-1", slideId: "slide-1", content: "Looks good" },
      { caller: "tool" },
    );

    expect(state.inserted.authorName).toBe("AI Agent");
    expect(state.inserted.authorKind).toBe("agent");
  });

  it("labels comments from other external callers as agent-authored", async () => {
    await run(
      { deckId: "deck-1", slideId: "slide-1", content: "Looks good" },
      { caller: "mcp" },
    );

    expect(state.inserted.authorKind).toBe("agent");
  });

  it("records comments typed in a widget as person-authored", async () => {
    await run(
      { deckId: "deck-1", slideId: "slide-1", content: "Looks good" },
      { caller: "mcp-widget-write" },
    );

    expect(state.inserted.authorKind).toBe("person");
    expect(state.inserted.authorName).not.toBe("AI Agent");
  });

  it("records frontend comments as person-authored", async () => {
    await run({ deckId: "deck-1", slideId: "slide-1", content: "Looks good" });

    expect(state.inserted.authorKind).toBe("person");
  });

  it("rejects a reply whose thread belongs to a different slide", async () => {
    state.rows.push({
      id: "root-2",
      deckId: "deck-1",
      slideId: "slide-2",
      threadId: "thread-2",
      parentId: null,
      resolved: false,
    });

    await expect(
      run({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Reply",
        threadId: "thread-2",
        parentId: "root-2",
      }),
    ).rejects.toThrow("Comment thread not found on this slide");
    expect(state.inserted).toEqual({});
  });

  it("rejects a parent comment outside the requested thread", async () => {
    await expect(
      run({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Reply",
        threadId: "thread-1",
        parentId: "root-2",
      }),
    ).rejects.toThrow("Parent comment not found in this thread");
    expect(state.inserted).toEqual({});
  });

  it("rejects comments for slides not present in the deck", async () => {
    await expect(
      run({ deckId: "deck-1", slideId: "slide-missing", content: "Comment" }),
    ).rejects.toThrow("Slide not found in deck");
    expect(state.inserted).toEqual({});
  });

  it("rechecks the deck under its lock before inserting", async () => {
    state.deckMissingAtLock = true;

    await expect(
      run({ deckId: "deck-1", slideId: "slide-1", content: "Comment" }),
    ).rejects.toThrow("Deck not found");
    expect(state.inserted).toEqual({});
  });

  it("mirrors nothing when the comment is refused", async () => {
    mirror.comments.mockClear();

    await expect(
      run({ deckId: "deck-1", slideId: "missing-slide", content: "Hi" }),
    ).rejects.toThrow();

    expect(mirror.comments).not.toHaveBeenCalled();
  });

  it("rejects replies to resolved threads", async () => {
    state.rows.forEach((row) => (row.resolved = true));

    await expect(
      run({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Reply",
        threadId: "thread-1",
        parentId: "root-1",
      }),
    ).rejects.toThrow("Reopen this comment thread before replying");
    expect(state.inserted).toEqual({});
  });

  it("requires a thread ID when the caller supplies a parent ID", () => {
    expect(
      (action as any).schema.safeParse({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Reply",
        parentId: "root-1",
      }).success,
    ).toBe(false);
  });

  it("requires a parent ID when the caller supplies a thread ID", () => {
    expect(
      (action as any).schema.safeParse({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Reply",
        threadId: "thread-1",
      }).success,
    ).toBe(false);
  });

  it("rejects empty relationship IDs", () => {
    for (const args of [
      { threadId: "", parentId: "root-1" },
      { threadId: "thread-1", parentId: "" },
      { threadId: "   ", parentId: "root-1" },
      { threadId: "thread-1", parentId: "   " },
    ]) {
      expect(
        (action as any).schema.safeParse({
          deckId: "deck-1",
          slideId: "slide-1",
          content: "Reply",
          ...args,
        }).success,
      ).toBe(false);
    }
  });
});
