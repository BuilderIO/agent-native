import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { ResourceSuggestion } from "../../review/suggestions/types.js";
import type { ReviewComment } from "../../review/types.js";
import {
  ReviewOptimisticCache,
  insertOptimisticComment,
  reconcileSuggestionAmendment,
  replaceOptimisticSuggestion,
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
  it("evicts the least recently active thread from a full newest-first page", () => {
    const olderRoot = comment("older-root", "Older root");
    const newerRoot = {
      ...comment("newer-root", "Newer root"),
      createdAt: "2026-09-22T11:00:00.000Z",
    };
    const recentReply = {
      ...comment("reply", "Recent activity"),
      threadId: olderRoot.id,
      parentCommentId: olderRoot.id,
      createdAt: "2026-09-22T12:00:00.000Z",
    };
    const incoming = {
      ...comment("incoming", "New thread"),
      createdAt: "2026-09-22T13:00:00.000Z",
    };
    expect(
      insertOptimisticComment([olderRoot, newerRoot, recentReply], incoming, {
        ...resource,
        newestFirst: true,
        limit: 2,
      }).map((item) => item.id),
    ).toEqual(["older-root", "reply", "incoming"]);
  });

  it("removes the optimistic suggestion when refetch already returned its server record", () => {
    const optimistic = suggestion("optimistic-1", "Proposal");
    const saved = suggestion("saved-1", "Proposal");

    expect(
      replaceOptimisticSuggestion([saved, optimistic], optimistic.id, saved),
    ).toEqual([saved]);
    expect(
      replaceOptimisticSuggestion([optimistic], optimistic.id, saved),
    ).toEqual([saved]);
  });

  it("does not duplicate a canonical comment refetched before its create response", () => {
    const queryClient = createQueryClient();
    const queryKey = ["action", "list-review-comments", resource] as const;
    queryClient.setQueryData(queryKey, commentsResult([]));
    const cache = new ReviewOptimisticCache(queryClient);
    const canonical = comment("rev_comment_operation-1", "New comment");
    const context = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data, params) => {
        const result = data as ListReviewCommentsResult;
        return {
          ...result,
          comments: insertOptimisticComment(result.comments, canonical, params),
        };
      },
    });

    queryClient.setQueryData(queryKey, commentsResult([canonical]));
    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments,
    ).toEqual([canonical]);
    cache.succeed(context, canonical);
    cache.settle(context);
  });

  it("applies a pending comment overlay to a query mounted after the mutation begins", () => {
    const queryClient = createQueryClient();
    const cache = new ReviewOptimisticCache(queryClient);
    const optimistic = comment("rev_comment_operation-2", "New comment");
    const context = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data, params) => {
        const result = data as ListReviewCommentsResult;
        if (!result?.comments) return data;
        return {
          ...result,
          comments: insertOptimisticComment(
            result.comments,
            optimistic,
            params,
          ),
        };
      },
    });
    const queryKey = [
      "action",
      "list-review-comments",
      { ...resource, includeResolved: true },
    ] as const;
    queryClient.setQueryData(queryKey, commentsResult([]));
    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments,
    ).toEqual([optimistic]);

    cache.fail(context);
    cache.settle(context);
    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments,
    ).toEqual([]);
  });

  it("keeps a newer refetched suggestion revision when an amendment response arrives late", () => {
    const original = suggestion("suggestion-1", "Original");
    const saved = { ...original, revision: 2, summary: "Older amendment" };
    const newer = { ...original, revision: 3, summary: "Newer amendment" };
    const queryClient = createQueryClient();
    const queryKey = ["action", "list-resource-suggestions", resource] as const;
    queryClient.setQueryData(queryKey, { suggestions: [original] });
    const cache = new ReviewOptimisticCache(queryClient);
    const context = cache.begin({
      action: "list-resource-suggestions",
      resource,
      transform: (data) => data,
      successReplacesOptimistic: true,
      onSuccess: (result) => (data) => ({
        suggestions: reconcileSuggestionAmendment(
          (data as { suggestions: ResourceSuggestion[] }).suggestions,
          result as ResourceSuggestion,
        ),
      }),
    });

    queryClient.setQueryData(queryKey, { suggestions: [newer] });
    cache.succeed(context, saved);
    cache.settle(context);
    expect(
      queryClient.getQueryData<{ suggestions: ResourceSuggestion[] }>(queryKey)
        ?.suggestions,
    ).toEqual([newer]);
    expect(reconcileSuggestionAmendment([original], saved)).toEqual([saved]);
  });

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

  it("rebases a pending change on a fresh query result", () => {
    const queryClient = createQueryClient();
    const queryKey = ["action", "list-review-comments", resource] as const;
    queryClient.setQueryData(
      queryKey,
      commentsResult([comment("comment-1", "Original")]),
    );
    const cache = new ReviewOptimisticCache(queryClient);
    const context = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data) => replaceCommentBody(data, "Pending"),
    });

    queryClient.setQueryData(
      queryKey,
      commentsResult([
        comment("comment-1", "Server update"),
        comment("comment-2", "New comment"),
      ]),
    );
    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments,
    ).toMatchObject([
      { id: "comment-1", body: "Pending" },
      { id: "comment-2", body: "Pending" },
    ]);

    cache.fail(context);
    cache.settle(context);
    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments,
    ).toMatchObject([
      { id: "comment-1", body: "Server update" },
      { id: "comment-2", body: "New comment" },
    ]);
  });

  it("keeps a newer refetched edit when an older edit response succeeds", () => {
    const queryClient = createQueryClient();
    const queryKey = ["action", "list-review-comments", resource] as const;
    queryClient.setQueryData(
      queryKey,
      commentsResult([comment("comment-1", "Old")]),
    );
    const cache = new ReviewOptimisticCache(queryClient);
    const context = cache.begin({
      action: "list-review-comments",
      resource,
      transform: (data) => replaceCommentBody(data, "Pending"),
      successReplacesOptimistic: true,
      onSuccess: () => (data) => {
        const current = data as ListReviewCommentsResult;
        return current.comments[0]!.updatedAt > "2026-09-22T11:00:00.000Z"
          ? data
          : replaceCommentBody(data, "Saved older edit");
      },
    });
    const newer = {
      ...comment("comment-1", "Newer server edit"),
      updatedAt: "2026-09-22T12:00:00.000Z",
    };
    queryClient.setQueryData(queryKey, commentsResult([newer]));
    cache.succeed(context, undefined);
    cache.settle(context);
    expect(
      queryClient.getQueryData<ListReviewCommentsResult>(queryKey)?.comments[0],
    ).toEqual(newer);
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

  it("preserves a newer suggestion decision when an older response succeeds late", () => {
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
      onSuccess: () => (data) => updateSuggestion(data, { status: "accepted" }),
    });
    const newer = cache.begin({
      action: "list-resource-suggestions",
      resource,
      transform: (data) => updateSuggestion(data, { status: "rejected" }),
      onSuccess: () => (data) => updateSuggestion(data, { status: "rejected" }),
    });
    cache.succeed(newer, undefined);
    cache.settle(newer);
    cache.succeed(older, undefined);
    cache.settle(older);
    expect(
      queryClient.getQueryData<{ suggestions: ResourceSuggestion[] }>(queryKey)
        ?.suggestions[0]?.status,
    ).toBe("rejected");
  });

  it("invalidates only the affected resource after its operation settles", () => {
    const queryClient = createQueryClient();
    const other = { resourceType: "document", resourceId: "document-2" };
    const firstKey = ["action", "list-review-comments", resource] as const;
    const secondKey = ["action", "list-review-comments", other] as const;
    const feedbackKey = ["action", "get-review-feedback", resource] as const;
    const otherFeedbackKey = ["action", "get-review-feedback", other] as const;
    queryClient.setQueryData(
      firstKey,
      commentsResult([comment("comment-1", "One")]),
    );
    queryClient.setQueryData(secondKey, commentsResult([]));
    queryClient.setQueryData(feedbackKey, { openCount: 1 });
    queryClient.setQueryData(otherFeedbackKey, { openCount: 0 });
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
    expect(queryClient.getQueryState(feedbackKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherFeedbackKey)?.isInvalidated).toBe(
      false,
    );
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
