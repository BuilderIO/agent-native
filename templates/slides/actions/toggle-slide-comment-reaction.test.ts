import type { ReviewCommentReaction } from "@agent-native/core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  list: vi.fn(),
  react: vi.fn(),
}));

vi.mock("@agent-native/core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/review")>()),
  assertReviewableResourceAccess: core.assertAccess,
}));
vi.mock("@agent-native/core/review/actions/list-review-comments", () => ({
  default: { run: core.list },
}));
vi.mock("@agent-native/core/review/actions/react-to-review-comment", () => ({
  default: { run: core.react },
}));

import action from "./toggle-slide-comment-reaction";

const CTX = { caller: "http", userEmail: "viewer@example.com" } as const;
const COMMENT = {
  id: "c-1",
  resourceId: "deck-1",
  threadId: "c-1",
  parentCommentId: null,
  targetId: "slide-1",
  status: "open",
  anchor: { kind: "slide", slideId: "slide-1" },
  body: "Hi",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function listing(reactions: ReviewCommentReaction[]) {
  return {
    comments: [COMMENT],
    discussion: { reactions: { "c-1": reactions } },
  };
}

beforeEach(() => vi.clearAllMocks());

// oracle-change: reactions moved to the core review store's reaction rows.
describe("toggle-slide-comment-reaction", () => {
  it("adds a reaction the caller has not made", async () => {
    core.list
      .mockResolvedValueOnce(
        listing([{ reaction: "👍", count: 1, reactedByMe: false }]),
      )
      .mockResolvedValueOnce(
        listing([{ reaction: "👍", count: 2, reactedByMe: true }]),
      );

    const result = await action.run(
      { commentId: "c-1", deckId: "deck-1", emoji: " 👍 " },
      CTX,
    );

    expect(core.react).toHaveBeenCalledWith(
      {
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "c-1",
        reaction: "👍",
        active: true,
      },
      expect.objectContaining({ userEmail: "viewer@example.com" }),
    );
    expect(result).toEqual({
      id: "c-1",
      emoji: "👍",
      reacted: true,
      reactions: [{ emoji: "👍", count: 2, reacted: true }],
    });
  });

  it("removes a reaction the caller already made", async () => {
    core.list
      .mockResolvedValueOnce(
        listing([{ reaction: "🎉", count: 1, reactedByMe: true }]),
      )
      .mockResolvedValueOnce(listing([]));

    const result = await action.run(
      { commentId: "c-1", deckId: "deck-1", emoji: "🎉" },
      CTX,
    );

    expect(core.react).toHaveBeenCalledWith(
      expect.objectContaining({ reaction: "🎉", active: false }),
      expect.objectContaining({ userEmail: CTX.userEmail }),
    );
    expect(result).toMatchObject({ reacted: false, reactions: [] });
  });

  it("returns 404 for a comment that is not on the deck", async () => {
    core.list.mockResolvedValue(listing([]));
    await expect(
      action.run({ commentId: "c-9", deckId: "deck-1", emoji: "👍" }, CTX),
    ).rejects.toMatchObject({ errorCode: "not_found", statusCode: 404 });
    expect(core.react).not.toHaveBeenCalled();
  });

  it("requires a signed-in caller", async () => {
    await expect(
      action.run(
        { commentId: "c-1", deckId: "deck-1", emoji: "👍" },
        { caller: "http" },
      ),
    ).rejects.toThrow("Sign in required");
    expect(core.react).not.toHaveBeenCalled();
  });
});
