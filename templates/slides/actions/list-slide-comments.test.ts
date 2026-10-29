import type { ReviewComment } from "@agent-native/core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ assertAccess: vi.fn(), list: vi.fn() }));

vi.mock("@agent-native/core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/review")>()),
  assertReviewableResourceAccess: core.assertAccess,
}));
vi.mock("@agent-native/core/review/actions/list-review-comments", () => ({
  default: { run: core.list },
}));

import action from "./list-slide-comments";

const CTX = { caller: "http", userEmail: "viewer@example.com" } as const;

function comment(id: string, overrides: Partial<ReviewComment> = {}) {
  return {
    id,
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: id,
    parentCommentId: null,
    targetId: "slide-1",
    status: "open",
    anchor: { kind: "slide", slideId: "slide-1" },
    body: `Body ${id}`,
    authorEmail: "a@example.com",
    authorName: "A",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ReviewComment;
}

beforeEach(() => {
  vi.clearAllMocks();
  core.list.mockResolvedValue({ comments: [] });
});

// oracle-change: comments moved to the core review store; profile-name and row-parsing cases are core's now.
describe("list-slide-comments", () => {
  it("returns review threads in the legacy row shape", async () => {
    core.list.mockResolvedValue({
      comments: [
        comment("root", {
          threadId: "t-1",
          status: "resolved",
          anchor: {
            kind: "slide",
            slideId: "slide-1",
            quotedText: "Revenue",
            point: { x: 10, y: 20 },
          },
        }),
        comment("reply", {
          threadId: "t-1",
          parentCommentId: "root",
          status: "resolved",
          anchor: null,
          createdAt: "2026-01-02T00:00:00.000Z",
        }),
      ],
      discussion: {
        reactions: { reply: [{ reaction: "👍", count: 2, reactedByMe: true }] },
      },
    });

    const result = await action.run(
      { deckId: "deck-1", slideId: "slide-1" },
      CTX,
    );

    expect(core.assertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      expect.objectContaining({ userEmail: CTX.userEmail }),
      "viewer",
    );
    expect(core.list).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "deck",
        resourceId: "deck-1",
        targetId: "slide-1",
        includeResolved: true,
      }),
      expect.objectContaining({ userEmail: "viewer@example.com" }),
    );
    expect(result.comments).toEqual([
      expect.objectContaining({
        id: "root",
        slide_id: "slide-1",
        thread_id: "t-1",
        parent_id: null,
        quoted_text: "Revenue",
        anchor: { x: 10, y: 20 },
        reactions: [],
        resolved: true,
      }),
      expect.objectContaining({
        id: "reply",
        slide_id: "slide-1",
        parent_id: "root",
        quoted_text: "Revenue",
        anchor: { x: 10, y: 20 },
        reactions: [{ emoji: "👍", count: 2, reacted: true }],
        resolved: true,
      }),
    ]);
  });

  it("pages by a stable created-at and id cursor", async () => {
    const same = "2026-01-01T00:00:00.000Z";
    core.list.mockResolvedValue({
      comments: [
        comment("e", { createdAt: "2026-01-03T00:00:00.000Z" }),
        comment("b", { createdAt: same }),
        comment("d", { createdAt: "2026-01-02T00:00:00.000Z" }),
        comment("a", { createdAt: same }),
        comment("c", { createdAt: same }),
      ],
    });

    const pages: string[][] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (;;) {
      const page = await action.run(
        { deckId: "deck-1", limit: 2, ...(cursor ? { cursor } : {}) },
        CTX,
      );
      pages.push(page.comments.map((row) => row.id));
      if (!page.has_more) {
        expect(page.next_cursor).toBeNull();
        break;
      }
      if (!page.next_cursor) throw new Error("has_more without a cursor");
      cursor = page.next_cursor;
    }

    expect(pages).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("keeps offset paging for older callers", async () => {
    core.list.mockResolvedValue({
      comments: ["a", "b", "c", "d"].map((id, index) =>
        comment(id, { createdAt: `2026-01-0${index + 1}T00:00:00.000Z` }),
      ),
    });

    const page = await action.run(
      { deckId: "deck-1", limit: 2, offset: 1 },
      CTX,
    );

    expect(page.comments.map((row) => row.id)).toEqual(["b", "c"]);
    expect(page).toMatchObject({ has_more: true, next_offset: 3, offset: 1 });
  });
});
