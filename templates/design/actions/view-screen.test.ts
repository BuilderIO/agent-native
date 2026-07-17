import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);

  return {
    getDb: vi.fn(() => ({
      select: vi.fn(() => selectChain),
    })),
    parseCanvasFrameGeometryById: vi.fn((value) => value ?? []),
    listAppState: vi.fn(),
    readAppState: vi.fn(),
    readAppStateForCurrentTab: vi.fn(),
    resolveAccess: vi.fn(),
    getReviewStatus: vi.fn(),
    getReviewThreadSummary: vi.fn(),
    queryReviewComments: vi.fn(),
    eq: vi.fn((left, right) => ({ left, right })),
    selectChain,
  };
});

vi.mock("@agent-native/core/application-state", () => ({
  listAppState: mocks.listAppState,
  readAppState: mocks.readAppState,
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("@agent-native/core/review", () => ({
  getReviewStatus: mocks.getReviewStatus,
  getReviewThreadSummary: mocks.getReviewThreadSummary,
  queryReviewComments: mocks.queryReviewComments,
  shouldRedactReviewIdentity: (
    ctx: { userEmail?: string | null } | undefined,
    access: { role: string; visibility?: string | null },
  ) =>
    !ctx?.userEmail ||
    (access.visibility === "public" && access.role === "viewer"),
  redactPublicReviewCommentIdentity: (comment: Record<string, unknown>) => ({
    ...comment,
    authorEmail: null,
    authorName:
      typeof comment.authorName === "string" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(comment.authorName)
        ? comment.authorName
        : null,
    ownerEmail: null,
    orgId: null,
  }),
  redactPublicReviewStatusIdentity: (status: Record<string, unknown> | null) =>
    status
      ? { ...status, updatedBy: null, ownerEmail: null, orgId: null }
      : null,
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: {
      id: "designFiles.id",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      updatedAt: "designFiles.updatedAt",
      designId: "designFiles.designId",
    },
  },
}));

vi.mock("../shared/canvas-frames.js", () => ({
  parseCanvasFrameGeometryById: mocks.parseCanvasFrameGeometryById,
}));

import action from "./view-screen.js";

describe("view-screen", () => {
  beforeEach(() => {
    mocks.listAppState.mockReset();
    mocks.readAppState.mockReset();
    mocks.readAppStateForCurrentTab.mockReset();
    mocks.resolveAccess.mockReset();
    mocks.getReviewStatus.mockReset();
    mocks.getReviewThreadSummary.mockReset();
    mocks.queryReviewComments.mockReset();
    mocks.selectChain.where.mockReset();
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        title: "Shared checkout",
        data: '{"canvasFrames":[]}',
      },
    });
    mocks.readAppState.mockResolvedValue(undefined);
    mocks.listAppState.mockResolvedValue([]);
    mocks.getReviewStatus.mockResolvedValue(null);
    mocks.getReviewThreadSummary.mockResolvedValue({
      openCount: 0,
      agentQueueCount: 0,
    });
    mocks.queryReviewComments.mockResolvedValue([]);
  });

  it("uses active file before overview multi-selection", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "overview",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "overview",
        activeFileId: "file_index",
        activeFilename: "index.html",
        selectedScreenIds: ["file_checkout"],
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_index",
      filename: "index.html",
    });
  });

  it("lists candidate reviews waiting on any design screen", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "overview",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "overview",
        activeFileId: "file_index",
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
    mocks.listAppState.mockImplementation(async (prefix: string) =>
      prefix === "design-reprompt-pending:design_123:"
        ? [
            {
              key: "design-reprompt-pending:design_123:file_checkout",
              value: {
                repromptId: "reprompt-1",
                designId: "design_123",
                fileId: "file_checkout",
                target: { nodeId: "hero" },
                baseVersionHash: "1:abc",
                instruction: "Improve the hero",
                createdAt: "2026-07-16T11:59:00.000Z",
              },
            },
          ]
        : [
            {
              key: "design-reprompt-proposal:design_123:file_checkout:reprompt-1",
              value: {
                proposalId: "proposal-1",
                repromptId: "reprompt-1",
                designId: "design_123",
                fileId: "file_checkout",
                filename: "checkout.html",
                baseVersionHash: "1:abc",
                target: { nodeId: "hero" },
                resolvedTarget: { nodeId: "hero", selector: "#hero" },
                variants: [
                  { html: "<section>One</section>", summary: "One" },
                  { html: "<section>Two</section>", summary: "Two" },
                ],
                chosenIndex: 0,
                createdAt: "2026-07-16T12:00:00.000Z",
              },
            },
          ],
    );

    const result = JSON.parse(await action.run({}));

    expect(result.design.pendingCandidateReviews).toEqual([
      {
        proposalId: "proposal-1",
        fileId: "file_checkout",
        filename: "checkout.html",
        candidateCount: 2,
        chosenIndex: 0,
        target: { nodeId: "hero" },
        createdAt: "2026-07-16T12:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(result.design.pendingCandidateReviews)).not.toContain(
      "<section>",
    );
    expect(mocks.listAppState).toHaveBeenCalledTimes(2);
    expect(mocks.listAppState).toHaveBeenCalledWith(
      "design-reprompt-proposal:design_123:",
    );
    expect(mocks.listAppState).toHaveBeenCalledWith(
      "design-reprompt-pending:design_123:",
    );
    expect(
      mocks.readAppState.mock.calls.some(([key]) =>
        String(key).startsWith("design-reprompt-proposal:"),
      ),
    ).toBe(false);
  });

  it("uses selected overview screen ids when no focused file is available", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "overview",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "overview",
        selectedScreenIds: ["file_checkout"],
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_checkout",
      filename: "checkout.html",
    });
  });

  it("uses navigation targets when selection state is not active yet", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
        filename: "checkout.html",
      })
      .mockResolvedValueOnce(null);
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_checkout",
      filename: "checkout.html",
    });
  });

  it("falls back to index.html for single-screen public views without selection", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "present",
        designId: "design_123",
      })
      .mockResolvedValueOnce(null);
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_settings",
        filename: "settings.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toMatchObject({
      id: "file_index",
      filename: "index.html",
    });
  });

  it("includes the open review queue for the active screen", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
        fileId: "file_checkout",
      })
      .mockResolvedValueOnce(null);
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
    mocks.getReviewStatus.mockResolvedValue({ status: "changes_requested" });
    mocks.getReviewThreadSummary.mockResolvedValue({
      openCount: 1,
      agentQueueCount: 1,
    });
    mocks.queryReviewComments.mockResolvedValue([
      {
        id: "comment_1",
        threadId: "thread_1",
        parentCommentId: null,
        targetId: "file_checkout",
        status: "open",
        body: "Make the button more prominent",
        anchor: { nodeId: "node_button", point: { xPct: 50, yPct: 50 } },
        resolutionTarget: "agent",
        consumedAt: null,
        authorName: "Reviewer",
        authorEmail: null,
        createdBy: "human",
      },
    ]);
    const result = JSON.parse(await action.run({}));

    expect(result.design.review).toMatchObject({
      status: "changes_requested",
      openCount: 1,
      agentQueueCount: 1,
      activeScreenThreads: [
        {
          threadId: "thread_1",
          nodeId: "node_button",
        },
      ],
    });
  });

  it("redacts reviewer emails from a signed-in public viewer", async () => {
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        title: "Shared checkout",
        data: '{"canvasFrames":[]}',
        visibility: "public",
      },
    });
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
        fileId: "file_checkout",
      })
      .mockResolvedValueOnce(null);
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
    mocks.queryReviewComments.mockResolvedValue([
      {
        id: "comment_private_identity",
        threadId: "thread_private_identity",
        parentCommentId: null,
        targetId: "file_checkout",
        status: "open",
        body: "Make the button more prominent",
        anchor: null,
        resolutionTarget: "human",
        consumedAt: null,
        authorName: "reviewer@example.com",
        authorEmail: "reviewer@example.com",
        ownerEmail: "owner@example.com",
        orgId: "example-org",
        createdBy: "human",
      },
    ]);

    const result = JSON.parse(
      await action.run({}, {
        userEmail: "public-viewer@example.com",
        caller: "agent",
      } as any),
    );

    expect(result.design.review.activeScreenThreads).toEqual([
      expect.objectContaining({
        threadId: "thread_private_identity",
        author: "human",
      }),
    ]);
    expect(JSON.stringify(result.design.review)).not.toContain(
      "reviewer@example.com",
    );
    expect(JSON.stringify(result.design.review)).not.toContain(
      "owner@example.com",
    );
  });

  it("uses the root routing target instead of counting agent-targeted replies", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
        fileId: "file_checkout",
      })
      .mockResolvedValueOnce(null);
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_checkout",
        filename: "checkout.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);
    mocks.queryReviewComments.mockResolvedValue([
      {
        id: "root_human",
        threadId: "thread_human",
        parentCommentId: null,
        targetId: "file_checkout",
        status: "open",
        body: "The agent asked for clarification",
        anchor: null,
        resolutionTarget: "human",
        consumedAt: null,
        authorName: "Reviewer",
        authorEmail: null,
        createdBy: "human",
      },
      {
        id: "reply_agent",
        threadId: "thread_human",
        parentCommentId: "root_human",
        targetId: "file_checkout",
        status: "open",
        body: "Question for the reviewer",
        anchor: null,
        resolutionTarget: "agent",
        consumedAt: null,
        authorName: "Agent",
        authorEmail: null,
        createdBy: "agent",
      },
    ]);
    mocks.getReviewThreadSummary.mockResolvedValue({
      openCount: 1,
      agentQueueCount: 0,
    });

    const result = JSON.parse(await action.run({}));

    expect(result.design.review).toMatchObject({
      openCount: 1,
      agentQueueCount: 0,
    });
  });

  it("reports the Templates view and selected built-in template", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "templates",
        templateId: "preset-social-square",
      })
      .mockResolvedValueOnce(null);

    const result = JSON.parse(await action.run({}));

    expect(result.navigation).toEqual({
      view: "templates",
      templateId: "preset-social-square",
    });
    expect(result.template).toMatchObject({
      id: "preset-social-square",
      isBuiltIn: true,
      source: "built-in",
      width: 1080,
      height: 1080,
    });
  });

  it("reports an accessible linked design system for a selected user template", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "list",
        templateId: "saved-template",
      })
      .mockResolvedValueOnce(null);
    mocks.resolveAccess.mockImplementation(async (type: string) => {
      if (type === "design-template") {
        return {
          role: "owner",
          resource: {
            title: "Saved template",
            category: "social",
            designSystemId: "system-1",
            visibility: "private",
          },
        };
      }
      if (type === "design-system") {
        return { role: "viewer", resource: { id: "system-1" } };
      }
      return null;
    });

    const result = JSON.parse(await action.run({}));

    expect(result.template).toMatchObject({
      id: "saved-template",
      isBuiltIn: false,
      source: "user",
      designSystemId: "system-1",
    });
  });
});
