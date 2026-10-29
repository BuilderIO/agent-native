import type { ReviewComment } from "@agent-native/core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getComment: vi.fn(),
  create: vi.fn(),
  reply: vi.fn(),
  deckData: "",
  deckReads: [] as { type: string; id: string; role: string }[],
}));

vi.mock("@agent-native/core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/review")>()),
  assertReviewableResourceAccess: core.assertAccess,
  getReviewCommentById: core.getComment,
}));
vi.mock("@agent-native/core/review/actions/create-review-comment", () => ({
  default: { run: core.create },
}));
vi.mock("@agent-native/core/review/actions/reply-review-comment", () => ({
  default: { run: core.reply },
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: async (type: string, id: string, role: string) => {
    core.deckReads.push({ type, id, role });
    return { role: "owner", resource: { id, data: core.deckData } };
  },
}));

import action from "./add-slide-comment";

const CTX = { caller: "http", userEmail: "tiana@example.com" } as const;

function parent(overrides: Partial<ReviewComment> = {}) {
  return {
    id: "root-1",
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: "thread-1",
    targetId: "slide-1",
    parentCommentId: null,
    status: "open",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  core.deckReads.length = 0;
  core.deckData = JSON.stringify({
    slides: [{ id: "slide-1" }, { id: "slide-2" }],
  });
  core.create.mockResolvedValue({ id: "c-1", threadId: "t-1", notified: true });
  core.reply.mockResolvedValue({
    id: "r-1",
    threadId: "thread-1",
    notified: false,
  });
});

// oracle-change: comments moved to the core review store; the table locking and notification cases are core's now.
describe("add-slide-comment", () => {
  it("starts a review thread anchored to the slide", async () => {
    const result = await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-2",
        content: "  Tighten this  ",
        quotedText: "Revenue",
        anchor: { x: 10, y: 20 },
      },
      CTX,
    );

    expect(core.assertAccess).toHaveBeenCalledWith(
      "deck",
      "deck-1",
      expect.objectContaining({ userEmail: "tiana@example.com" }),
      "commenter",
    );
    expect(core.create).toHaveBeenCalledWith(
      {
        resourceType: "deck",
        resourceId: "deck-1",
        targetId: "slide-2",
        anchor: {
          kind: "slide",
          slideId: "slide-2",
          quotedText: "Revenue",
          point: { x: 10, y: 20 },
        },
        body: "Tighten this",
        resolutionTarget: "human",
      },
      expect.objectContaining({ userEmail: "tiana@example.com" }),
    );
    expect(core.reply).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "c-1", threadId: "t-1", notified: true });
  });

  it("replies through the review store when the parent is in the thread", async () => {
    core.getComment.mockResolvedValue(parent());
    const result = await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-1",
        content: "Done",
        threadId: "thread-1",
        parentId: "root-1",
      },
      CTX,
    );

    expect(core.reply).toHaveBeenCalledWith(
      {
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "root-1",
        body: "Done",
      },
      expect.objectContaining({ userEmail: "tiana@example.com" }),
    );
    expect(core.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: "r-1",
      threadId: "thread-1",
      notified: false,
    });
  });

  it.each([
    ["is missing", null],
    ["is on another deck", parent({ resourceId: "deck-2" })],
    ["is in another thread", parent({ threadId: "thread-2" })],
    ["is on another slide", parent({ targetId: "slide-2" })],
  ])("returns 404 when the parent %s", async (_label, found) => {
    core.getComment.mockResolvedValue(found);
    await expect(
      action.run(
        {
          deckId: "deck-1",
          slideId: "slide-1",
          content: "Reply",
          threadId: "thread-1",
          parentId: "root-1",
        },
        CTX,
      ),
    ).rejects.toMatchObject({ errorCode: "not_found", statusCode: 404 });
    expect(core.reply).not.toHaveBeenCalled();
  });

  it("returns 409 when replying to a resolved thread", async () => {
    core.getComment.mockResolvedValue(parent({ status: "resolved" }));
    await expect(
      action.run(
        {
          deckId: "deck-1",
          slideId: "slide-1",
          content: "Reply",
          threadId: "thread-1",
          parentId: "root-1",
        },
        CTX,
      ),
    ).rejects.toMatchObject({
      errorCode: "comment_thread_resolved",
      statusCode: 409,
    });
    expect(core.reply).not.toHaveBeenCalled();
  });

  it("returns 404 for a slide that is not in the deck", async () => {
    await expect(
      action.run({ deckId: "deck-1", slideId: "slide-9", content: "Hi" }, CTX),
    ).rejects.toMatchObject({ errorCode: "not_found", statusCode: 404 });
    expect(core.create).not.toHaveBeenCalled();
    // The slide check reads the deck through its access check, never bare.
    expect(core.deckReads).toContainEqual({
      type: "deck",
      id: "deck-1",
      role: "commenter",
    });
  });
});
