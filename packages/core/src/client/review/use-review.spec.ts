import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { ResourceSuggestion } from "../../review/suggestions/types.js";
import type { ReviewComment } from "../../review/types.js";
import {
  ReviewOptimisticCache,
  type ListReviewCommentsResult,
} from "./use-review.js";

const resource = { resourceType: "document", resourceId: "document-1" };

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function comment(id: string, body: string): ReviewComment {
  return {
    id,
    ...resource,
    threadId: id,
    parentCommentId: null,
    targetId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    body,
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
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
    metadata: null,
  };
}

function commentsResult(comments: ReviewComment[]): ListReviewCommentsResult {
  return {
    comments,
    discussion: {
      reactions: {},
      threadPreferences: {},
      canReact: true,
      canSetThreadPreferences: true,
    },
    reviewStatus: null,
    summary: { openCount: comments.length, agentQueueCount: 0 },
  };
}

function suggestion(id: string, summary: string): ResourceSuggestion {
  return {
    id,
    revision: 1,
    ...resource,
    adapterKind: "document",
    adapterVersion: 1,
    threadId: `thread-${id}`,
    authorEmail: "alice@example.com",
    actorKind: "human",
    baseRevision: "revision-1",
    status: "pending",
    summary,
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
    metadata: null,
    operations: [],
  };
}

describe("ReviewOptimisticCache", () => {
  it("keeps a delayed created comment visible and swaps it for the server record", () => {
    const queryClient = createQueryClient();
    const queryKey = ["action", "list-review-comments", resource] as const;
    queryClient.setQueryData(queryKey, commentsResult([]));
    const cache = new ReviewOptimisticCache(queryClient);
    const optimistic = comment("rev_comment_operation-1", "Draft comment");
    const saved = { ...optimistic, authorName: "Alice Moore" };

    const context = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data) => {
        const current = data as ListReviewCommentsResult;
        return { ...current, comments: [...current.comments, optimistic] };
      },
      onSuccess: (result) => (data) => {
        const current = data as ListReviewCommentsResult;
        return {
          ...current,
          comments: current.comments.map((item) =>
            item.id === optimistic.id ? (result as ReviewComment) : item,
          ),
        };
      },
    });

    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments,
    ).toEqual([optimistic]);

    cache.succeed(context, saved);
    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments,
    ).toEqual([saved]);
    cache.settle(context);
  });

  it("rolls back an older failed comment update without undoing a newer update", () => {
    const queryClient = createQueryClient();
    const queryKey = ["action", "list-review-comments", resource] as const;
    queryClient.setQueryData(
      queryKey,
      commentsResult([comment("comment-1", "Original")]),
    );
    const cache = new ReviewOptimisticCache(queryClient);

    const first = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data) => replaceCommentBody(data, "First draft"),
    });
    const second = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data) => replaceCommentBody(data, "Newest draft"),
    });

    cache.succeed(second, undefined);
    cache.settle(second);
    cache.fail(first);
    cache.settle(first);

    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments[0]
        ?.body,
    ).toBe("Newest draft");
  });

  it("preserves a newer suggestion decision when an older decision fails late", () => {
    const queryClient = createQueryClient();
    const queryKey = ["action", "list-resource-suggestions", resource] as const;
    queryClient.setQueryData(queryKey, {
      suggestions: [suggestion("suggestion-1", "Original")],
    });
    const cache = new ReviewOptimisticCache(queryClient);

    const older = cache.begin({
      action: "list-resource-suggestions",
      resource,
      transform: (data) => updateSuggestion(data, { status: "accepted" }),
    });
    const newer = cache.begin({
      action: "list-resource-suggestions",
      resource,
      transform: (data) => updateSuggestion(data, { summary: "Revised" }),
    });

    cache.succeed(newer, undefined);
    cache.settle(newer);
    cache.fail(older);
    cache.settle(older);

    expect(
      queryClient.getQueryData<{ suggestions: ResourceSuggestion[] }>(queryKey)
        ?.suggestions[0],
    ).toMatchObject({ status: "pending", summary: "Revised" });
  });

  it("invalidates only the affected resource after its operation settles", () => {
    const queryClient = createQueryClient();
    const other = { resourceType: "document", resourceId: "document-2" };
    const firstKey = ["action", "list-review-comments", resource] as const;
    const secondKey = ["action", "list-review-comments", other] as const;
    queryClient.setQueryData(
      firstKey,
      commentsResult([comment("comment-1", "One")]),
    );
    queryClient.setQueryData(secondKey, commentsResult([]));
    const cache = new ReviewOptimisticCache(queryClient);

    const context = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data) => replaceCommentBody(data, "Updated"),
    });
    cache.succeed(context, undefined);
    cache.settle(context);

    expect(queryClient.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(secondKey)?.isInvalidated).toBe(false);
  });
});

function replaceCommentBody(data: unknown, body: string) {
  const current = data as ListReviewCommentsResult;
  return {
    ...current,
    comments: current.comments.map((item) => ({ ...item, body })),
  };
}

function updateSuggestion(
  data: unknown,
  changes: Partial<Pick<ResourceSuggestion, "status" | "summary">>,
) {
  const current = data as { suggestions: ResourceSuggestion[] };
  return {
    ...current,
    suggestions: current.suggestions.map((item) => ({ ...item, ...changes })),
  };
}
