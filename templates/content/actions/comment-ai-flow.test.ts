import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  request: {} as Record<string, any>,
  source: {} as Record<string, any>,
  updates: [] as Array<Record<string, any>>,
  retainedPayload: undefined as unknown,
  transactionDigest: "thread-digest",
  documentRevision: "base-revision",
  transactionError: null as Error | null,
  resolvedRows: false,
  earlierRequests: null as Array<{ id: string }> | null,
}));

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  editDocument: vi.fn(),
  createSuggestion: vi.fn(),
  createProposal: vi.fn(),
  listSuggestions: vi.fn(),
  assertSourceUnchanged: vi.fn(),
  requireRequest: vi.fn(),
  updateRequest: vi.fn(),
  transaction: vi.fn(),
}));

function receipt() {
  const request = state.request;
  return {
    requestId: request.id,
    documentId: request.documentId,
    threadId: request.threadId,
    rootCommentId: request.rootCommentId,
    intent: request.intent,
    status: request.status,
    runId: request.runId ?? null,
    agentThreadId: request.agentThreadId ?? null,
    result: request.result ?? null,
    error: request.error ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

vi.mock("../server/lib/comment-ai.js", () => ({
  CommentAiOperationError: class CommentAiOperationError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly recoverable: boolean,
    ) {
      super(message);
    }
  },
  assertCommentAiSourceUnchanged: (...args: unknown[]) =>
    mocks.assertSourceUnchanged(...args),
  assertCommentAiThreadUnchanged: async () => {
    if (state.transactionDigest !== state.request.threadDigest)
      throw new Error(
        "The comment changed during this request. Its thread remains open for review.",
      );
  },
  commentThreadDigest: () => state.transactionDigest,
  requireCommentAiRequest: (...args: unknown[]) =>
    mocks.requireRequest(...args),
  beginCommentAiAttempt: async () => {
    state.request.status = "running";
    state.request.error = null;
    return {
      request: state.request,
      attempt: {
        id: "attempt-1",
        attemptNumber: 1,
        sourceRevision: "base-revision",
        payloadJson: null,
        threadDigest: state.request.threadDigest,
      },
      source: state.source,
    };
  },
  verifyCommentAiAttempt: async () => ({
    attempt: {
      id: "attempt-1",
      status: "reasoning",
      sourceRevision: "base-revision",
      threadDigest: state.request.threadDigest,
    },
    source: state.source,
    currentRevision: state.documentRevision,
    sourceRevisionMatches: true,
  }),
  retainCommentAiAttemptPayload: async (
    _request: unknown,
    _attemptId: string,
    payload: unknown,
  ) => {
    state.retainedPayload ??= payload;
    return state.retainedPayload;
  },
  completeCommentAiAttempt: vi.fn(),
  markCommentAiRefreshRequired: vi.fn(),
  retainCommentAiPayload: async (_request: unknown, payload: unknown) => {
    state.retainedPayload ??= payload;
    state.request.payloadJson = JSON.stringify(state.retainedPayload);
    state.request.status = "running";
    return state.retainedPayload;
  },
  serializeCommentAiRequest: () => receipt(),
  updateCommentAiRequest: (...args: unknown[]) => mocks.updateRequest(...args),
}));

vi.mock("./add-comment.js", () => ({
  default: { run: (...args: unknown[]) => mocks.addComment(...args) },
  commentIdForIdempotency: () => "reply-id",
  addCommentWithGuard: async (args: unknown, ctx: unknown, guard: any) => {
    const { getDb } = await import("../server/db/index.js");
    await getDb().transaction(guard);
    return mocks.addComment(args, ctx);
  },
}));

vi.mock("./edit-document.js", () => ({
  default: { run: (...args: unknown[]) => mocks.editDocument(...args) },
}));

vi.mock(
  "@agent-native/core/review/suggestions/actions/create-resource-suggestion",
  () => ({
    default: { run: (...args: unknown[]) => mocks.createSuggestion(...args) },
  }),
);

vi.mock(
  "@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal",
  () => ({
    default: { run: (...args: unknown[]) => mocks.createProposal(...args) },
  }),
);

vi.mock("../server/lib/suggested-edits.js", () => ({
  CONTENT_DOCUMENT_SUGGESTION_ADAPTER: "content-document",
}));

vi.mock(
  "@agent-native/core/review/suggestions/actions/list-resource-suggestions",
  () => ({
    default: { run: (...args: unknown[]) => mocks.listSuggestions(...args) },
  }),
);

vi.mock("./_document-edit-mutation.js", () => ({
  documentContentHash: (content: string) => `hash:${content}`,
  documentRevisionToken: () => state.documentRevision,
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    documents: { id: "documents.id", ownerEmail: "documents.ownerEmail" },
    documentComments: {
      documentId: "comments.documentId",
      threadId: "comments.threadId",
      ownerEmail: "comments.ownerEmail",
    },
    commentAiRequests: { id: "requests.id" },
    commentAiAttempts: { id: "attempts.id" },
  };
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === schema.documents
              ? [state.source.document]
              : table === schema.commentAiRequests
                ? (state.earlierRequests ?? [state.request])
                : state.source.comments;
          return Object.assign(Promise.resolve(rows), {
            for: async () => rows,
          });
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (table === schema.documentComments && patch.resolved === 1) {
            state.resolvedRows = true;
          }
          if (table === schema.commentAiRequests) {
            Object.assign(state.request, patch);
            if (typeof patch.resultJson === "string") {
              state.request.result = JSON.parse(patch.resultJson);
            }
          }
        },
      }),
    }),
  };
  const db = {
    transaction: (...args: unknown[]) => mocks.transaction(tx, ...args),
    select: tx.select,
  };
  return { getDb: () => db, schema };
});

import applyRequest from "./apply-comment-ai-request.js";
import createSuggestion from "./create-comment-ai-suggestion.js";
import getContext from "./get-comment-ai-context.js";
import replyRequest from "./reply-to-comment-ai-request.js";

const ctx = {
  caller: "tool" as const,
  userEmail: "agent@example.test",
  actionName: "comment-ai-operation",
};

function run(
  action: { run: (args: any, ctx: any) => Promise<unknown> },
  args: unknown,
) {
  return action.run({ attemptId: "attempt-1", ...(args as object) }, ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSuggestions.mockResolvedValue({ suggestions: [] });
  state.documentRevision = "base-revision";
  state.request = {
    id: "11111111-1111-4111-8111-111111111111",
    ownerEmail: "owner@example.test",
    requesterEmail: "agent@example.test",
    documentId: "page-1",
    threadId: "thread-1",
    rootCommentId: "comment-1",
    fieldId: "body",
    intent: "reply",
    status: "running",
    threadDigest: "thread-digest",
    payloadJson: null,
    result: null,
    error: null,
    baseRevision: "base-revision",
    suggestionRevision: "suggestion-revision",
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  };
  state.source = {
    document: {
      id: "page-1",
      content: "Before text",
      bodyRevision: 1,
      updatedAt: "suggestion-revision",
    },
    comments: [{ id: "comment-1", parentId: null, content: "Please fix" }],
  };
  state.updates = [];
  state.retainedPayload = undefined;
  state.transactionDigest = "thread-digest";
  state.transactionError = null;
  state.resolvedRows = false;
  state.earlierRequests = null;

  mocks.requireRequest.mockImplementation(async (intent?: string) => {
    if (intent && state.request.intent !== intent) {
      throw new Error(
        "This operation is not permitted by the selected comment intent",
      );
    }
    return state.request;
  });
  mocks.assertSourceUnchanged.mockImplementation(async () => state.source);
  mocks.updateRequest.mockImplementation(
    async (_request: unknown, update: Record<string, any>) => {
      state.updates.push(update);
      state.request.status = update.status;
      if (update.result !== undefined) state.request.result = update.result;
      state.request.error = update.error ?? null;
      return receipt();
    },
  );
  mocks.addComment.mockResolvedValue({ id: "ai-receipt-1", duplicate: false });
  mocks.createSuggestion.mockResolvedValue({ id: "suggestion-1" });
  mocks.createProposal.mockResolvedValue({
    proposal: { id: "proposal-1" },
    suggestions: [{ id: "suggestion-1" }, { id: "suggestion-2" }],
  });
  mocks.editDocument.mockImplementation(async () => {
    state.source.document.content = "After text";
    return {
      receipt: {
        outcome: "applied",
        readback: { verified: true },
        hashes: { after: "hash:After text" },
      },
    };
  });
  mocks.transaction.mockImplementation(async (tx: any, callback: any) => {
    if (state.transactionError) throw state.transactionError;
    return callback(tx);
  });
});

describe("comment AI dedicated action boundaries", () => {
  it.each([
    [
      "reply",
      createSuggestion,
      { summary: "Fix", edits: [{ find: "Before", replace: "After" }] },
    ],
    [
      "reply",
      applyRequest,
      { summary: "Fixed", edits: [{ find: "Before", replace: "After" }] },
    ],
    ["suggest", replyRequest, { content: "Answer" }],
  ])(
    "rejects a %s request sent to a different operation",
    async (_intent, action, args) => {
      state.request.intent = _intent;

      await expect(run(action as any, args)).rejects.toThrow(
        "not permitted by the selected comment intent",
      );

      expect(mocks.assertSourceUnchanged).not.toHaveBeenCalled();
      expect(mocks.addComment).not.toHaveBeenCalled();
      expect(mocks.createSuggestion).not.toHaveBeenCalled();
      expect(mocks.editDocument).not.toHaveBeenCalled();
      expect(state.resolvedRows).toBe(false);
    },
  );

  it("posts a reply only to the bound page, thread, and root comment", async () => {
    state.request.intent = "reply";

    const result = await run(replyRequest as any, { content: "The answer" });

    expect(mocks.addComment).toHaveBeenCalledWith(
      {
        documentId: "page-1",
        threadId: "thread-1",
        parentId: "comment-1",
        content: "The answer",
        clientOperationId: "reply-id",
      },
      ctx,
    );
    expect(result).toMatchObject({
      status: "replied",
      result: { commentId: "ai-receipt-1" },
    });
    expect(mocks.createSuggestion).not.toHaveBeenCalled();
    expect(mocks.editDocument).not.toHaveBeenCalled();
    expect(state.resolvedRows).toBe(false);
  });

  it.each(["Page", "comment"])(
    "rejects a %s change after context was read and before reply commit",
    async (changed) => {
      state.request.intent = "reply";
      if (changed === "Page") state.documentRevision = "new-revision";
      else state.transactionDigest = "new-thread-digest";
      const operation = run(replyRequest as any, { content: "Stale answer" });
      if (changed === "Page") {
        await expect(operation).resolves.toBeUndefined();
      } else {
        await expect(operation).rejects.toThrow(
          /changed before the answer was saved/,
        );
      }
      expect(mocks.addComment).not.toHaveBeenCalled();
      if (changed === "comment") {
        expect(state.request.status).toBe("needs-review");
      }
    },
  );

  it("creates one reviewable suggestion with source-comment provenance and leaves feedback open", async () => {
    state.request.intent = "suggest";

    const result = await run(createSuggestion as any, {
      summary: "Clarify [this]",
      edits: [{ find: "Before", replace: "After" }],
    });

    expect(mocks.createProposal).not.toHaveBeenCalled();
    expect(mocks.createSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "document",
        resourceId: "page-1",
        baseRevision: "suggestion-revision",
        idempotencyKey:
          "comment-ai:11111111-1111-4111-8111-111111111111:suggestion",
        operations: [
          expect.objectContaining({
            before: expect.objectContaining({ changedText: "Before" }),
            after: expect.objectContaining({ changedText: "After" }),
          }),
        ],
        metadata: expect.objectContaining({
          sourceCommentId: "comment-1",
          sourceThreadId: "thread-1",
          sourceUrl: "/page/page-1?comment=thread-1",
          commentAiRequestId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
      ctx,
    );
    expect(mocks.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "page-1",
        threadId: "thread-1",
        parentId: "comment-1",
        clientOperationId: "reply-id",
        content: "[Clarify this](/page/page-1?suggestion=suggestion-1)",
      }),
      ctx,
    );
    expect(result).toMatchObject({
      status: "suggested",
      result: { suggestionId: "suggestion-1", commentId: "ai-receipt-1" },
    });
    expect(mocks.editDocument).not.toHaveBeenCalled();
    expect(state.resolvedRows).toBe(false);
  });

  const filler = "Unchanged prose stays out of the review. ".repeat(40);
  it.each([
    [
      "one span that reaches across unchanged text",
      [
        {
          find: `Open source is open.\n\n${filler}\n\nFork Open source`,
          replace: `Open-source is open.\n\n${filler}\n\nFork Open-source`,
        },
      ],
    ],
    [
      "separate edits",
      [
        { find: "Open source is", replace: "Open-source is" },
        { find: "Fork Open source", replace: "Fork Open-source" },
      ],
    ],
  ])(
    "proposes each change on its own, linked to the comment, from %s",
    async (_shape, edits) => {
      state.request.intent = "suggest";
      state.source.document.content = `Open source is open.\n\n${filler}\n\nFork Open source today.`;
      // A first request on its comment has no earlier edits to look up.
      state.earlierRequests = [];

      const result = await run(createSuggestion as any, {
        summary: "Hyphenate Open-source",
        edits,
      });

      expect(mocks.createSuggestion).not.toHaveBeenCalled();
      expect(mocks.listSuggestions).not.toHaveBeenCalled();
      const [proposal] = mocks.createProposal.mock.calls[0]!;
      expect(proposal).toMatchObject({
        resourceId: "page-1",
        summary: "Hyphenate Open-source",
        idempotencyKey:
          "comment-ai:11111111-1111-4111-8111-111111111111:proposal",
      });
      expect(
        proposal.suggestions.map(
          (suggestion: { operations: any[] }) => suggestion.operations,
        ),
      ).toEqual([
        [
          expect.objectContaining({
            ordinal: 0,
            before: expect.objectContaining({ changedText: " " }),
            after: expect.objectContaining({ changedText: "-" }),
          }),
        ],
        [
          expect.objectContaining({
            ordinal: 0,
            before: expect.objectContaining({ changedText: " " }),
            after: expect.objectContaining({ changedText: "-" }),
          }),
        ],
      ]);
      for (const suggestion of proposal.suggestions) {
        expect(suggestion.metadata).toMatchObject({
          sourceThreadId: "thread-1",
          commentAiRequestId: "11111111-1111-4111-8111-111111111111",
        });
      }
      expect(mocks.addComment).toHaveBeenCalledWith(
        expect.objectContaining({
          content:
            "[Hyphenate Open-source](/page/page-1?suggestion=suggestion-1)",
        }),
        ctx,
      );
      expect(result).toMatchObject({
        status: "suggested",
        result: { suggestionId: "suggestion-1" },
      });
    },
  );

  it("replaces the requester's earlier edits on this comment with the new proposal", async () => {
    state.request.intent = "suggest";
    state.source.document.content = "Open source and Open source again.";
    mocks.listSuggestions.mockResolvedValue({
      suggestions: [
        {
          id: "earlier-suggestion",
          adapterKind: "content-document",
          authorEmail: "agent@example.test",
          createdAt: "2026-09-07T00:00:00.000Z",
          metadata: {
            sourceThreadId: "thread-1",
            commentAiRequestId: "earlier-request",
          },
        },
      ],
    });
    state.earlierRequests = [{ id: "earlier-request" }];

    await run(createSuggestion as any, {
      summary: "Hyphenate both",
      edits: [
        { find: "Open source and", replace: "Open-source and" },
        { find: "Open source again", replace: "Open-source again" },
      ],
    });

    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ supersedes: ["earlier-suggestion"] }),
      ctx,
    );
  });

  it("replaces this request's single edit when a retry proposes several", async () => {
    state.request.intent = "suggest";
    state.source.document.content = "Open source and Open source again.";
    state.earlierRequests = [];
    state.request.result = { suggestionId: "first-attempt" };
    const fromThisRequest = (id: string, proposalId: string | null) => ({
      id,
      proposalId,
      adapterKind: "content-document",
      authorEmail: "agent@example.test",
      createdAt: "2026-09-08T00:00:01.000Z",
      metadata: {
        sourceThreadId: "thread-1",
        commentAiRequestId: state.request.id,
      },
    });
    mocks.listSuggestions.mockResolvedValue({
      suggestions: [
        fromThisRequest("first-attempt", null),
        fromThisRequest("own-proposal-edit", "proposal-1"),
      ],
    });

    await run(createSuggestion as any, {
      summary: "Hyphenate both",
      edits: [
        { find: "Open source and", replace: "Open-source and" },
        { find: "Open source again", replace: "Open-source again" },
      ],
    });

    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ supersedes: ["first-attempt"] }),
      ctx,
    );
  });

  it("keeps a suggestion request recoverable when feedback changes before its receipt", async () => {
    state.request.intent = "suggest";
    mocks.createSuggestion.mockImplementationOnce(async () => {
      state.transactionDigest = "changed-thread";
      return { id: "suggestion-1" };
    });

    await expect(
      run(createSuggestion as any, {
        summary: "Clarify this",
        edits: [{ find: "Before", replace: "After" }],
      }),
    ).rejects.toThrow(
      "comment discussion changed before the proposal receipt was saved",
    );
    expect(mocks.addComment).not.toHaveBeenCalled();
    expect(state.request).toMatchObject({
      status: "needs-review",
      result: { suggestionId: "suggestion-1" },
    });
  });
});

describe("apply-and-resolve partial failure recovery", () => {
  const args = {
    summary: "Applied the requested correction",
    edits: [{ find: "Before", replace: "After" }],
  };

  beforeEach(() => {
    state.request.intent = "apply-resolve";
  });

  it("keeps the thread open when its source becomes stale after a verified edit", async () => {
    state.transactionDigest = "stale-thread";

    await expect(run(applyRequest as any, args)).rejects.toThrow(
      "comment discussion changed after the edit was saved",
    );

    expect(state.request.result).toEqual({
      editApplied: true,
      changes: [{ before: "Before", after: "After" }],
      undoable: true,
      commentId: "ai-receipt-1",
    });
    expect(mocks.addComment).toHaveBeenCalledOnce();
    expect(state.request.status).toBe("needs-review");
    expect(state.resolvedRows).toBe(false);
  });

  it("retries an interrupted post-edit flow with the same edit and receipt keys, without changing targets", async () => {
    state.transactionError = new Error("transaction interrupted");
    await expect(run(applyRequest as any, args)).rejects.toThrow(
      "transaction interrupted",
    );

    state.transactionError = null;
    const result = await run(applyRequest as any, {
      summary: "Different retry text must not replace retained payload",
      edits: [{ find: "Wrong", replace: "Wrong" }],
    });

    expect(mocks.editDocument).toHaveBeenCalledOnce();
    expect(mocks.editDocument.mock.calls.map(([input]) => input)).toEqual([
      {
        id: "page-1",
        edits: args.edits,
        baseRevision: "base-revision",
        idempotencyKey: "comment-ai:11111111-1111-4111-8111-111111111111:edit",
      },
    ]);
    expect(mocks.addComment.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        documentId: "page-1",
        threadId: "thread-1",
        parentId: "comment-1",
        content: args.summary,
        clientOperationId: "reply-id",
      }),
      expect.objectContaining({
        documentId: "page-1",
        threadId: "thread-1",
        parentId: "comment-1",
        content: args.summary,
        clientOperationId: "reply-id",
      }),
    ]);
    expect(state.resolvedRows).toBe(true);
    expect(result).toMatchObject({
      status: "resolved",
      result: {
        editApplied: true,
        commentId: "ai-receipt-1",
        resolved: true,
      },
    });
  });
});

it("returns current running context when retrying an incomplete operation", async () => {
  state.request.status = "needs-review";
  state.request.error = "Previous run ended";
  state.request.snapshotJson = "[]";
  state.source.root = { quotedText: null };
  const result = await run(getContext, {});
  expect(result).toMatchObject({
    request: { status: "running", error: null },
    operationCompleted: false,
    nextAction: "reply-to-comment-ai-request",
  });
});

it("reports prior proposal decisions without treating them as the current result", async () => {
  state.request.intent = "suggest";
  state.request.snapshotJson = "[]";
  state.source.root = { quotedText: null };
  const prior = (
    id: string,
    status: string,
    sourceThreadId = "thread-1",
    adapterKind = "content-document",
    commentAiRequestId = "prior-request",
  ) => ({
    id,
    status,
    adapterKind,
    summary: "Earlier proposal",
    metadata: { sourceThreadId, commentAiRequestId },
  });
  mocks.listSuggestions.mockResolvedValue({
    suggestions: [
      ...["pending", "accepted", "rejected", "stale", "superseded"].map(
        (status) => prior(status, status),
      ),
      prior("other-thread", "pending", "thread-2"),
      prior("other-adapter", "pending", "thread-1", "another-adapter"),
      prior(
        "current",
        "pending",
        "thread-1",
        "content-document",
        state.request.id,
      ),
    ],
  });
  const result = (await run(getContext, {})) as any;
  expect(result.operationCompleted).toBe(false);
  expect(result.nextAction).toBe("create-comment-ai-suggestion");
  expect(result.priorSuggestions.map((s: any) => s.status)).toEqual([
    "pending",
    "accepted",
    "rejected",
    "stale",
    "superseded",
  ]);
  expect(mocks.listSuggestions).toHaveBeenCalledWith(
    { resourceType: "document", resourceId: "page-1" },
    ctx,
  );
});
