// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useReviewComments: vi.fn(),
}));

vi.mock("@agent-native/core/client/review", () => ({
  useReviewComments: mocks.useReviewComments,
}));

import {
  slideCommentThreads,
  slideReviewQueryParams,
  useSlideComments,
} from "./use-slide-comments";

function comment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: "c1",
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: "c1",
    parentCommentId: null,
    targetId: "slide-1",
    kind: "comment",
    status: "open",
    anchor: null,
    body: "Body",
    authorEmail: "alice@example.com",
    authorName: "Alice",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    metadata: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("slideCommentThreads", () => {
  it("reads the slide, quote and canvas point from the root's anchor", () => {
    const point = { x: 10, y: 20, objectId: "title", objectX: 5, objectY: 50 };
    const thread = slideCommentThreads([
      comment({
        id: "root",
        threadId: "root",
        targetId: "stale-target",
        anchor: {
          kind: "slide",
          slideId: "slide-7",
          quotedText: "Q3 Revenue",
          point,
        },
        // oracle-change: the hook reads core's list-review-comments, so its own pagination checks went with list-slide-comments.
      }),
      comment({ id: "reply", threadId: "root", parentCommentId: "root" }),
    ]).at(0);
    expect(thread).toMatchObject({
      threadId: "root",
      slideId: "slide-7",
      quotedText: "Q3 Revenue",
      anchor: point,
      resolved: false,
    });
    expect(thread?.review.replies.map((reply) => reply.id)).toEqual(["reply"]);
  });

  it("falls back to the target id for a thread without a Slides anchor", () => {
    const thread = slideCommentThreads([
      comment({ anchor: { x: 1 }, status: "resolved" }),
    ]).at(0);
    expect(thread).toMatchObject({
      slideId: "slide-1",
      anchor: null,
      quotedText: null,
      resolved: true,
    });
  });
});

describe("useSlideComments", () => {
  const comments = [
    comment({ id: "a", threadId: "a", targetId: "slide-1" }),
    comment({ id: "b", threadId: "b", targetId: "slide-2" }),
  ];

  it("shares one deck-wide query and filters threads to the slide", () => {
    mocks.useReviewComments.mockReturnValue({
      data: { comments, discussion: undefined },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useSlideComments("deck-1", "slide-2"));
    expect(mocks.useReviewComments).toHaveBeenCalledWith(
      slideReviewQueryParams("deck-1"),
      { enabled: true },
    );
    expect(result.current.data?.map((thread) => thread.threadId)).toEqual([
      "b",
    ]);

    const deck = renderHook(() => useSlideComments("deck-1", null, "deck"));
    expect(deck.result.current.data?.map((thread) => thread.threadId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("stays loading, not empty, until the query has data", () => {
    mocks.useReviewComments.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useSlideComments(null, "slide-1"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
    expect(mocks.useReviewComments).toHaveBeenCalledWith(
      slideReviewQueryParams(""),
      { enabled: false },
    );
  });
});
