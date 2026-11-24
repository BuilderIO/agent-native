// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callActionWithRetry: vi.fn(),
  apiDisabledReason: vi.fn((): string | null => null),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callActionWithRetry: mocks.callActionWithRetry,
}));

vi.mock("@agent-native/core/client/api-surface", () => ({
  agentNativeApiDisabledReason: mocks.apiDisabledReason,
}));

import { useSlideComments } from "./use-slide-comments";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function comment(
  id: string,
  threadId: string,
  parentCommentId: string | null = null,
  extra: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    resourceType: "deck",
    resourceId: "deck-1",
    targetId: null,
    surfaceId: "slide-1",
    threadId,
    parentCommentId,
    kind: "comment",
    anchor: null,
    anchorKind: null,
    anchorVersion: null,
    body: id,
    authorEmail: "author@example.com",
    authorName: "Author",
    createdBy: "human",
    status: "open",
    resolutionTarget: "human",
    mentions: [],
    metadata: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  } as ReviewComment;
}

function page(
  comments: ReviewComment[],
  nextCursor: string | null,
  reactions: Record<string, unknown[]> = {},
) {
  return {
    comments,
    nextCursor,
    discussion: {
      reactions,
      threadPreferences: {},
      canReact: true,
      canSetThreadPreferences: true,
    },
    reviewStatus: null,
    summary: null,
  };
}

const deckParams = {
  resourceType: "deck",
  resourceId: "deck-1",
  includeResolved: true,
  limit: 500,
};

afterEach(() => cleanup());

beforeEach(() => {
  mocks.callActionWithRetry.mockReset();
  mocks.apiDisabledReason.mockReset();
  mocks.apiDisabledReason.mockReturnValue(null);
});

describe("useSlideComments", () => {
  it("loads every page of the slide and groups replies that cross a page boundary", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      comment(`comment-${index}`, `thread-${index}`),
    );
    const thumbsUp = { reaction: "👍", count: 1, reactedByMe: true };
    const heart = { reaction: "❤️", count: 2, reactedByMe: false };
    mocks.callActionWithRetry
      .mockResolvedValueOnce(
        page(firstPage, "cursor-1", { "comment-0": [thumbsUp] }),
      )
      .mockResolvedValueOnce(
        page([comment("reply-1", "thread-0", "comment-0")], null, {
          "reply-1": [heart],
        }),
      );

    const { result } = renderHook(() => useSlideComments("deck-1", "slide-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.callActionWithRetry).toHaveBeenNthCalledWith(
      1,
      "list-review-comments",
      { ...deckParams, surfaceId: "slide-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.callActionWithRetry).toHaveBeenNthCalledWith(
      2,
      "list-review-comments",
      { ...deckParams, surfaceId: "slide-1", cursor: "cursor-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const threads = result.current.data?.threads ?? [];
    expect(threads).toHaveLength(500);
    expect(threads[0]?.root.id).toBe("comment-0");
    expect(threads[0]?.replies.map(({ id }) => id)).toEqual(["reply-1"]);
    expect(result.current.data?.discussion.reactions).toEqual({
      "comment-0": [thumbsUp],
      "reply-1": [heart],
    });
  });

  it("reads a thread's slide, quoted text, anchor and status from its first comment", async () => {
    mocks.callActionWithRetry.mockResolvedValueOnce(
      page(
        [
          comment("root", "thread-1", null, {
            surfaceId: "slide-2",
            status: "resolved",
            anchor: { x: 10, y: 20 },
            anchorKind: "slide-point",
            metadata: { quotedText: "Quarterly revenue" },
          }),
        ],
        null,
      ),
    );

    const { result } = renderHook(
      () => useSlideComments("deck-1", null, "deck"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.callActionWithRetry).toHaveBeenCalledWith(
      "list-review-comments",
      deckParams,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data?.threads[0]).toMatchObject({
      threadId: "thread-1",
      slideId: "slide-2",
      resolved: true,
      quotedText: "Quarterly revenue",
      anchor: { x: 10, y: 20 },
    });
  });

  it("surfaces a later page failure without partial data", async () => {
    mocks.callActionWithRetry
      .mockResolvedValueOnce(
        page([comment("comment-1", "thread-1")], "cursor-1"),
      )
      .mockRejectedValueOnce(new Error("Second page unavailable"));

    const { result } = renderHook(
      () => useSlideComments("deck-1", null, "deck"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(new Error("Second page unavailable"));
    expect(result.current.data).toBeUndefined();
  });

  it("refuses a cursor it has already followed instead of looping", async () => {
    mocks.callActionWithRetry
      .mockResolvedValueOnce(
        page([comment("comment-1", "thread-1")], "cursor-1"),
      )
      .mockResolvedValueOnce(
        page([comment("comment-2", "thread-2")], "cursor-1"),
      );

    const { result } = renderHook(
      () => useSlideComments("deck-1", null, "deck"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(
      "Could not load all slide comments: invalid pagination response.",
    );
    expect(result.current.data).toBeUndefined();
    expect(mocks.callActionWithRetry).toHaveBeenCalledTimes(2);
  });

  it("keeps the query disabled when the Agent-Native API is unavailable", () => {
    mocks.apiDisabledReason.mockReturnValue("embedded surface");

    const { result } = renderHook(() => useSlideComments("deck-1", "slide-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(mocks.callActionWithRetry).not.toHaveBeenCalled();
  });
});
