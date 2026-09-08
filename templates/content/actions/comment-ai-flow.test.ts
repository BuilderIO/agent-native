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
}));

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  editDocument: vi.fn(),
  createSuggestion: vi.fn(),
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
  assertCommentAiSourceUnchanged: (...args: unknown[]) =>
    mocks.assertSourceUnchanged(...args),
  commentThreadDigest: () => state.transactionDigest,
  requireCommentAiRequest: (...args: unknown[]) =>
    mocks.requireRequest(...args),
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

vi.mock("../server/lib/suggested-edits.js", () => ({
  CONTENT_DOCUMENT_SUGGESTION_ADAPTER: "content-document",
}));

vi.mock("../shared/document-text-edits.js", () => ({
  resolveDocumentTextEdits: (
    content: string,
    edits: Array<{ find: string; replace: string }>,
  ) => ({
    ok: true,
    content: content.replace(edits[0].find, edits[0].replace),
  }),
}));

vi.mock("../app/components/editor/suggestions/markdown-operation.js", () => ({
  markdownSuggestionOperation: () => ({ type: "replace", from: 0, to: 5 }),
}));

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
  };
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === schema.documents
              ? [state.source.document]
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
        },
      }),
    }),
  };
  const db = {
    transaction: (...args: unknown[]) => mocks.transaction(tx, ...args),
  };
  return { getDb: () => db, schema };
});

import applyRequest from "./apply-comment-ai-request.js";
import createSuggestion from "./create-comment-ai-suggestion.js";
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
  return action.run(args, ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
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
      { summary: "Fix", find: "Before", replace: "After" },
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
        idempotencyKey: "comment-ai:11111111-1111-4111-8111-111111111111:reply",
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
      await expect(
        run(replyRequest as any, { content: "Stale answer" }),
      ).rejects.toThrow(/changed during this request/);
      expect(mocks.addComment).not.toHaveBeenCalled();
      expect(state.request.status).toBe("needs-review");
    },
  );

  it("creates one reviewable suggestion with source-comment provenance and leaves feedback open", async () => {
    state.request.intent = "suggest";

    const result = await run(createSuggestion as any, {
      summary: "Clarify [this]",
      find: "Before",
      replace: "After",
    });

    expect(mocks.createSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "document",
        resourceId: "page-1",
        baseRevision: "suggestion-revision",
        idempotencyKey:
          "comment-ai:11111111-1111-4111-8111-111111111111:suggestion",
        metadata: {
          sourceCommentId: "comment-1",
          sourceThreadId: "thread-1",
          sourceUrl: "/page/page-1?comment=thread-1",
          commentAiRequestId: "11111111-1111-4111-8111-111111111111",
        },
      }),
      ctx,
    );
    expect(mocks.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "page-1",
        threadId: "thread-1",
        parentId: "comment-1",
        idempotencyKey:
          "comment-ai:11111111-1111-4111-8111-111111111111:receipt",
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
      "comment changed after the edit was saved",
    );

    expect(state.request.result).toEqual({
      editApplied: true,
      commentId: "ai-receipt-1",
    });
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

    expect(mocks.editDocument).toHaveBeenCalledTimes(2);
    expect(mocks.editDocument.mock.calls.map(([input]) => input)).toEqual([
      {
        id: "page-1",
        edits: args.edits,
        baseRevision: "base-revision",
        idempotencyKey: "comment-ai:11111111-1111-4111-8111-111111111111:edit",
      },
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
        idempotencyKey:
          "comment-ai:11111111-1111-4111-8111-111111111111:receipt",
      }),
      expect.objectContaining({
        documentId: "page-1",
        threadId: "thread-1",
        parentId: "comment-1",
        content: args.summary,
        idempotencyKey:
          "comment-ai:11111111-1111-4111-8111-111111111111:receipt",
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
