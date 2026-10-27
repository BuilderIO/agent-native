import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    activeTable: string;
    designData: string;
    sourceComments: Array<Record<string, unknown>>;
    reviewComments: Array<Record<string, any>>;
    role: string;
    folderName: string;
    creatorId: string;
    postStatus: number;
    currentUserEmail: string;
    postedComment: Record<string, unknown>;
  } = {
    activeTable: "",
    designData: "",
    sourceComments: [],
    reviewComments: [],
    role: "owner",
    folderName: "Drafts",
    creatorId: "figma-user-1",
    postStatus: 200,
    currentUserEmail: "steve@example.com",
    postedComment: {},
  };
  const selectChain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  } = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockImplementation((table: unknown) => {
    state.activeTable =
      typeof table === "object" && table !== null && "id" in table
        ? String(table.id)
        : table;
    return selectChain;
  });
  selectChain.where.mockImplementation(async () =>
    state.activeTable === "designs.id"
      ? [{ data: state.designData }]
      : [{ id: "file-1" }],
  );
  const db = { select: vi.fn(() => selectChain) };

  const insertReviewCommentIdempotently = vi.fn(async (input: any) => {
    const existing = state.reviewComments.find(
      (comment) => comment.id === input.id,
    );
    if (existing) return { comment: existing, replayed: true };
    const comment = {
      ...input,
      threadId: input.threadId ?? input.id,
      status: "open",
      createdAt: "2026-10-27T00:00:00.000Z",
    };
    state.reviewComments.push(comment);
    return { comment, replayed: false };
  });
  const insertReviewReplyIdempotently = vi.fn(async (input: any) => {
    const existing = state.reviewComments.find(
      (comment) => comment.id === input.id,
    );
    if (existing) return { comment: existing, replayed: true };
    const comment = {
      ...input,
      status: "open",
      createdAt: "2026-10-27T00:01:00.000Z",
    };
    state.reviewComments.push(comment);
    return { comment, replayed: false };
  });
  const resolveReviewThread = vi.fn(
    async (
      threadId: string,
      _by: unknown,
      _resource: unknown,
      _note: unknown,
      status: string,
    ) => {
      for (const comment of state.reviewComments) {
        if (comment.threadId === threadId) comment.status = status;
      }
      return 1;
    },
  );
  const mutateDesignData = vi.fn(async (input: any) => {
    const current = JSON.parse(state.designData);
    const next = input.mutate(current, {
      updatedAt: "2026-10-27T00:00:00.000Z",
    });
    state.designData = JSON.stringify(next);
    if (!input.isApplied(next)) throw new Error("Mutation did not apply.");
    return { data: next, updatedAt: next.updatedAt, updatedFiles: [] };
  });

  return {
    state,
    db,
    assertAccess: vi.fn(),
    assertReviewableResourceAccess: vi.fn(),
    queryReviewComments: vi.fn(),
    insertReviewCommentIdempotently,
    insertReviewReplyIdempotently,
    resolveReviewThread,
    getRequestUserEmail: vi.fn(),
    fetchFigmaNodeSnapshot: vi.fn(),
    executeProviderApiRequest: vi.fn(),
    mutateDesignData,
    and: vi.fn((...conditions) => conditions),
    eq: vi.fn((field, value) => ({ field, value })),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/review", () => ({
  assertReviewableResourceAccess: mocks.assertReviewableResourceAccess,
  insertReviewCommentIdempotently: mocks.insertReviewCommentIdempotently,
  insertReviewReplyIdempotently: mocks.insertReviewReplyIdempotently,
  queryReviewComments: mocks.queryReviewComments,
  resolveReviewThread: mocks.resolveReviewThread,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: { id: "designs.id", data: "designs.data" },
    designFiles: { id: "designFiles.id", designId: "designFiles.designId" },
  },
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

vi.mock("../server/lib/provider-api.js", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../server/lib/figma-node-import.js", () => ({
  fetchFigmaNodeSnapshot: mocks.fetchFigmaNodeSnapshot,
  providerJson: (envelope: any) => envelope.response.json,
}));

import action from "./sync-figma-comments.js";

const screen = {
  figmaFileKey: "abcDEF12345",
  figmaNodeId: "1:2",
  figmaSync: {
    figmaVersion: "1",
    figmaNodeHash: "baseline-hash",
    designHash: "design-hash",
  },
};

function setDesignData() {
  mocks.state.designData = JSON.stringify({
    screenMetadata: { "file-1": { ...screen } },
  });
}

function sourceEnvelope(json: unknown, status = 200) {
  return { response: { ok: status >= 200 && status < 300, status, json } };
}

function setSourceComments(comments: Array<Record<string, unknown>>) {
  mocks.state.sourceComments = comments;
  mocks.executeProviderApiRequest.mockImplementation(
    async ({ method, path }: { method: string; path: string }) => {
      if (path === "/me") {
        return sourceEnvelope({
          id: "figma-user-1",
          email: mocks.state.currentUserEmail,
        });
      }
      if (path === "/files/abcDEF12345/meta") {
        return sourceEnvelope({
          file: {
            folder_name: mocks.state.folderName,
            role: mocks.state.role,
            creator: { id: mocks.state.creatorId },
          },
        });
      }
      if (method === "POST") {
        return sourceEnvelope(
          mocks.state.postedComment,
          mocks.state.postStatus,
        );
      }
      return sourceEnvelope({ comments: mocks.state.sourceComments });
    },
  );
}

function sourceCommentStore() {
  return [
    {
      id: "remote-root",
      message: "Please adjust the heading.",
      parent_id: null,
      resolved_at: "2026-10-26T10:00:00.000Z",
      created_at: "2026-10-26T09:00:00.000Z",
      client_meta: { node_id: "1:2" },
      user: { id: "author-1", handle: "designer" },
    },
    {
      id: "remote-reply",
      message: "Updated.",
      parent_id: "remote-root",
      created_at: "2026-10-26T09:30:00.000Z",
      user: { id: "author-2", handle: "reviewer" },
    },
  ];
}

describe("sync-figma-comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDesignData();
    mocks.state.reviewComments = [];
    mocks.state.role = "owner";
    mocks.state.folderName = "Drafts";
    mocks.state.creatorId = "figma-user-1";
    mocks.state.postStatus = 200;
    mocks.state.currentUserEmail = "steve@example.com";
    mocks.state.postedComment = {
      id: "remote-created",
      message: "New note",
      parent_id: null,
      created_at: "2026-10-27T00:00:00.000Z",
      user: { id: "figma-user-1", handle: "steve" },
    };
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.assertReviewableResourceAccess.mockResolvedValue({
      ownerEmail: "steve@example.com",
      orgId: null,
      visibility: "private",
    });
    mocks.fetchFigmaNodeSnapshot.mockImplementation(async () => ({
      node: { id: "1:2" },
      version: "1",
      lastModified: null,
      role: mocks.state.role,
    }));
    mocks.getRequestUserEmail.mockReturnValue("steve@example.com");
    mocks.queryReviewComments.mockImplementation(async () => [
      ...mocks.state.reviewComments,
    ]);
    setSourceComments([]);
  });

  it("imports authors, reply threads, location metadata, and resolved state idempotently", async () => {
    setSourceComments(sourceCommentStore());

    const first = await action.run(
      {
        designId: "design-1",
        fileId: "file-1",
        direction: "from-figma",
      } as any,
      { userEmail: "steve@example.com" } as any,
    );
    const second = await action.run(
      {
        designId: "design-1",
        fileId: "file-1",
        direction: "from-figma",
      } as any,
      { userEmail: "steve@example.com" } as any,
    );

    expect(first).toMatchObject({ imported: 2, resolved: 1 });
    expect(second).toMatchObject({ imported: 0, resolved: 0 });
    expect(mocks.insertReviewCommentIdempotently).toHaveBeenCalledWith(
      expect.objectContaining({
        authorName: "designer",
        metadata: {
          figmaSync: expect.objectContaining({
            commentId: "remote-root",
            handle: "designer",
            resolvedAt: "2026-10-26T10:00:00.000Z",
            clientMeta: { node_id: "1:2" },
          }),
        },
      }),
    );
    expect(mocks.insertReviewReplyIdempotently).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCommentId: expect.any(String),
        body: "Updated.",
        authorName: "reviewer",
      }),
      null,
      { resourceType: "design", resourceId: "design-1" },
    );
    expect(mocks.resolveReviewThread).toHaveBeenCalledTimes(1);
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("publishes an eligible own comment once and stops before writes for a non-owned file", async () => {
    mocks.state.reviewComments = [
      {
        id: "local-comment",
        threadId: "local-comment",
        parentCommentId: null,
        body: "New note",
        createdBy: "human",
        authorEmail: "steve@example.com",
        mentions: [],
        createdAt: "2026-10-27T00:00:00.000Z",
        status: "open",
        metadata: {},
      },
    ];

    const first = await action.run(
      { designId: "design-1", fileId: "file-1", direction: "to-figma" } as any,
      { userEmail: "steve@example.com" } as any,
    );
    const second = await action.run(
      { designId: "design-1", fileId: "file-1", direction: "to-figma" } as any,
      { userEmail: "steve@example.com" } as any,
    );

    expect(first).toMatchObject({ published: 1 });
    expect(second).toMatchObject({ published: 0 });
    expect(
      mocks.executeProviderApiRequest.mock.calls.filter(
        ([request]: any[]) => request.method === "POST",
      ),
    ).toHaveLength(1);

    mocks.state.role = "editor";
    await expect(
      action.run(
        {
          designId: "design-1",
          fileId: "file-1",
          direction: "to-figma",
        } as any,
        { userEmail: "steve@example.com" } as any,
      ),
    ).rejects.toThrow("personal Draft");
    expect(
      mocks.executeProviderApiRequest.mock.calls.filter(
        ([request]: any[]) => request.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("blocks comment writes outside the connected account's Drafts space", async () => {
    mocks.state.folderName = "Product team";
    mocks.state.reviewComments = [
      {
        id: "local-comment",
        threadId: "local-comment",
        parentCommentId: null,
        body: "New note",
        createdBy: "human",
        authorEmail: "steve@example.com",
        mentions: [],
        createdAt: "2026-10-27T00:00:00.000Z",
        status: "open",
        metadata: {},
      },
    ];

    await expect(
      action.run(
        {
          designId: "design-1",
          fileId: "file-1",
          direction: "to-figma",
        } as any,
        { userEmail: "steve@example.com" } as any,
      ),
    ).rejects.toMatchObject({
      errorCode: "figma_comments_personal_draft_required",
      statusCode: 403,
    });
    expect(
      mocks.executeProviderApiRequest.mock.calls.filter(
        ([request]: any[]) => request.method === "POST",
      ),
    ).toHaveLength(0);
  });

  it("reports rate limits separately from credential failures", async () => {
    mocks.state.postStatus = 429;
    mocks.state.reviewComments = [
      {
        id: "local-comment",
        threadId: "local-comment",
        parentCommentId: null,
        body: "New note",
        createdBy: "human",
        authorEmail: "steve@example.com",
        mentions: [],
        createdAt: "2026-10-27T00:00:00.000Z",
        status: "open",
        metadata: {},
      },
    ];

    const result = await action.run(
      { designId: "design-1", fileId: "file-1", direction: "to-figma" } as any,
      { userEmail: "steve@example.com" } as any,
    );

    expect(result).toMatchObject({ skipped: 1 });
    expect(result.warnings).toContain(
      "The source is rate limiting comment sync. Try again later.",
    );
  });
});
