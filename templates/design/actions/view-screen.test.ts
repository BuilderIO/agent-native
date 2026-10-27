import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  const contentSelectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  contentSelectChain.from.mockReturnValue(contentSelectChain);
  contentSelectChain.where.mockReturnValue(contentSelectChain);
  const requestSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  requestSelectChain.from.mockReturnValue(requestSelectChain);
  requestSelectChain.where.mockReturnValue(requestSelectChain);

  return {
    getDb: vi.fn(() => ({
      select: vi.fn((columns) =>
        columns?.requesterEmail
          ? requestSelectChain
          : columns?.content
            ? contentSelectChain
            : selectChain,
      ),
    })),
    parseCanvasFrameGeometryById: vi.fn((value) => value ?? []),
    listAppState: vi.fn(),
    readAppState: vi.fn(),
    readAppStateForCurrentTab: vi.fn(),
    resolveAccess: vi.fn(),
    getReviewStatus: vi.fn(),
    getReviewThreadSummary: vi.fn(),
    getReviewThreadRoot: vi.fn(),
    queryReviewComments: vi.fn(),
    eq: vi.fn((left, right) => ({ left, right })),
    selectChain,
    contentSelectChain,
    requestSelectChain,
    getDesignSystemRun: vi.fn(async ({ id }: { id: string }) => ({
      id,
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    })),
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
  getReviewThreadRoot: mocks.getReviewThreadRoot,
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
  and: vi.fn((...conditions) => ({ conditions })),
  eq: mocks.eq,
  inArray: vi.fn((column, values) => ({ column, values })),
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
      content: "designFiles.content",
    },
    designReviewAgentRequests: {
      id: "requests.id",
      designId: "requests.designId",
      threadId: "requests.threadId",
      status: "requests.status",
      intent: "requests.intent",
      requesterEmail: "requests.requesterEmail",
    },
  },
}));

vi.mock("../shared/canvas-frames.js", () => ({
  parseCanvasFrameGeometryById: mocks.parseCanvasFrameGeometryById,
}));

vi.mock("./get-design-system.js", () => ({
  default: { run: mocks.getDesignSystemRun },
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
    mocks.getReviewThreadRoot.mockReset();
    mocks.selectChain.where.mockReset();
    mocks.contentSelectChain.limit.mockResolvedValue([]);
    mocks.requestSelectChain.limit.mockReset();
    mocks.requestSelectChain.limit.mockResolvedValue([]);
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
    mocks.getReviewThreadRoot.mockResolvedValue(null);
  });

  it("reports the design's own linked design system, not just a template's", async () => {
    mocks.resolveAccess.mockResolvedValue({
      role: "editor",
      resource: {
        title: "Shared checkout",
        liveCollaborationEnabled: true,
        designSystemId: "system-7",
        data: '{"canvasFrames":[]}',
      },
    });
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
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(mocks.getDesignSystemRun).toHaveBeenCalledWith(
      expect.objectContaining({ compact: "true" }),
    );
    expect(result.design?.designSystemId).toBe("system-7");
    expect(result.design?.liveCollaborationEnabled).toBe(true);
    expect(result.design?.designSystem).toMatchObject({
      status: "available",
      scope: "summary",
      id: "system-7",
      agentContext: "Use --brand-accent: #123456.",
      next: expect.any(String),
    });
  });

  it("reports no linked design system rather than guessing one", async () => {
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
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design?.designSystemId).toBeNull();
  });

  it("shows the Interact preview's device and theme from the published selection", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "single",
        mode: "interact",
        activeFileId: "file_index",
        activeFilename: "index.html",
        interact: {
          device: { name: "iPhone 17", width: 402, height: 874 },
          theme: "dark",
        },
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.designSelection.mode).toBe("interact");
    expect(result.designSelection.interact).toEqual({
      device: { name: "iPhone 17", width: 402, height: 874 },
      theme: "dark",
    });
  });

  it("reports a System theme as System, and describes the three themes to the agent", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "single",
        mode: "interact",
        activeFileId: "file_index",
        activeFilename: "index.html",
        interact: {
          device: { name: "iPhone 17", width: 402, height: 874 },
          theme: "system",
        },
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.designSelection.interact.theme).toBe("system");
    expect(action.tool.description).toMatch(
      /theme, light, dark or system \(system, the default, shows the design as authored/,
    );
    expect(action.tool.description).not.toMatch(/follows the editor/);
  });

  it("hands the editor's mode, active tool and open panel to the agent as published", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "single",
        activeFileId: "file_index",
        activeFilename: "index.html",
        mode: "interact",
        activeTool: "move",
        leftPanel: "agent",
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.designSelection).toMatchObject({
      mode: "interact",
      activeTool: "move",
      leftPanel: "agent",
    });
  });

  it("hands the agent the Threads panel and the Comment tool while the user is pinning a comment", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "overview",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "overview",
        mode: "annotate",
        activeTool: "comment",
        leftPanel: "threads",
      });
    mocks.selectChain.where.mockResolvedValue([]);

    const result = JSON.parse(await action.run({}));

    expect(result.designSelection).toMatchObject({
      mode: "annotate",
      activeTool: "comment",
      leftPanel: "threads",
    });
  });

  it("does not report an inspector tab, even when a stale selection record has one", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "single",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "single",
        mode: "edit",
        activeFileId: "file_index",
        activeFilename: "index.html",
        inspectorTab: "comments",
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.designSelection).toMatchObject({
      mode: "edit",
      activeFileId: "file_index",
    });
    expect(result.designSelection).not.toHaveProperty("inspectorTab");
  });

  it("uses active file before overview multi-selection", async () => {
    mocks.contentSelectChain.limit.mockResolvedValue([
      {
        content:
          '<html><head><meta name="agent-native:frame-type" content="hubspot-email"></head><body>Email</body></html>',
      },
    ]);
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
      frameType: "hubspot-email",
    });
  });

  it("does not report JSX support files as overview screens", async () => {
    mocks.readAppStateForCurrentTab
      .mockResolvedValueOnce({
        view: "editor",
        editorView: "overview",
        designId: "design_123",
      })
      .mockResolvedValueOnce({
        viewMode: "overview",
        activeFileId: "support",
      });
    mocks.selectChain.where.mockResolvedValue([
      {
        id: "file_index",
        filename: "index.html",
        fileType: "html",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
      {
        id: "support",
        filename: "support.jsx",
        fileType: "jsx",
        updatedAt: "2026-06-29T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(result.design.activeScreen).toBeNull();
    expect(
      result.design.screens.map((file: { id: string }) => file.id),
    ).toEqual(["file_index"]);
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

  describe("the open review thread", () => {
    function openEditorWithThread(reviewThreadId: string | null | undefined) {
      mocks.readAppStateForCurrentTab
        .mockResolvedValueOnce({
          view: "editor",
          editorView: "single",
          designId: "design_123",
          fileId: "file_checkout",
        })
        .mockResolvedValueOnce(
          reviewThreadId === undefined
            ? { activeFileId: "file_checkout" }
            : { activeFileId: "file_checkout", reviewThreadId },
        );
      mocks.selectChain.where.mockResolvedValue([
        {
          id: "file_checkout",
          filename: "checkout.html",
          fileType: "html",
          updatedAt: "2026-06-29T00:00:00.000Z",
        },
      ]);
    }

    const rootComment = {
      id: "comment_root",
      threadId: "thread_open",
      parentCommentId: null,
      targetId: "file_checkout",
      status: "open",
      body: "Hey @[Sam Lee](mailto:sam@example.com) make the button bigger",
      anchor: { nodeId: "node_button", point: { xPct: 50, yPct: 50 } },
      deletedAt: null,
    };

    it("is null when no thread is open, and does not look anything up", async () => {
      openEditorWithThread(null);

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread).toBeNull();
      expect(mocks.getReviewThreadRoot).not.toHaveBeenCalled();
    });

    it("is null for a selection record that predates the field", async () => {
      openEditorWithThread(undefined);

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread).toBeNull();
    });

    it("summarizes a readable thread, including a resolved one", async () => {
      openEditorWithThread("thread_open");
      mocks.getReviewThreadRoot.mockResolvedValue({
        ...rootComment,
        status: "resolved",
      });
      mocks.queryReviewComments.mockImplementation(
        async (input: { includeResolved?: boolean }) =>
          input.includeResolved
            ? [
                { ...rootComment, status: "resolved" },
                {
                  ...rootComment,
                  id: "reply_1",
                  parentCommentId: "comment_root",
                  status: "resolved",
                },
                {
                  ...rootComment,
                  id: "other_root",
                  threadId: "thread_other",
                },
              ]
            : [],
      );

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread).toEqual({
        threadId: "thread_open",
        screenId: "file_checkout",
        anchorNodeId: "node_button",
        status: "resolved",
        activeAgentRequest: null,
        commentCount: 2,
        preview: "Hey @Sam Lee make the button bigger",
      });
      expect(mocks.getReviewThreadRoot).toHaveBeenCalledWith(
        "thread_open",
        { resourceType: "design", resourceId: "design_123" },
        expect.anything(),
        { bypassScope: true },
      );
      expect(mocks.queryReviewComments).toHaveBeenCalledWith(
        expect.objectContaining({
          includeResolved: true,
          includeDeleted: false,
          targetId: "file_checkout",
        }),
      );
    });

    it("reports the agent run working on the thread, and whether it is the viewer's", async () => {
      mocks.getReviewThreadRoot.mockResolvedValue(rootComment);
      mocks.queryReviewComments.mockResolvedValue([rootComment]);
      mocks.requestSelectChain.limit.mockResolvedValue([
        {
          id: "request_1",
          status: "running",
          intent: "apply-resolve",
          requesterEmail: "me@example.com",
        },
      ]);

      openEditorWithThread("thread_open");
      const mine = JSON.parse(
        await action.run({}, { caller: "tool", userEmail: "me@example.com" }),
      );
      openEditorWithThread("thread_open");
      const theirs = JSON.parse(
        await action.run({}, { caller: "tool", userEmail: "you@example.com" }),
      );

      expect(mine.design.review.openThread.activeAgentRequest).toEqual({
        requestId: "request_1",
        status: "running",
        intent: "apply-resolve",
        requesterIsMe: true,
      });
      expect(
        theirs.design.review.openThread.activeAgentRequest.requesterIsMe,
      ).toBe(false);
    });

    it("keeps an agent run that has not been classified yet as an unset intent", async () => {
      openEditorWithThread("thread_open");
      mocks.getReviewThreadRoot.mockResolvedValue(rootComment);
      mocks.queryReviewComments.mockResolvedValue([rootComment]);
      mocks.requestSelectChain.limit.mockResolvedValue([
        {
          id: "request_2",
          status: "classifying",
          intent: null,
          requesterEmail: "me@example.com",
        },
      ]);

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread.activeAgentRequest).toMatchObject({
        status: "classifying",
        intent: null,
      });
    });

    it("is unavailable, and logs, when the agent run lookup fails", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        openEditorWithThread("thread_open");
        mocks.getReviewThreadRoot.mockResolvedValue(rootComment);
        mocks.queryReviewComments.mockResolvedValue([rootComment]);
        mocks.requestSelectChain.limit.mockRejectedValue(new Error("db down"));

        const result = JSON.parse(await action.run({}));

        expect(result.design.review.openThread).toEqual({
          threadId: "thread_open",
          unavailable: true,
        });
        expect(consoleError).toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    it("bounds the preview and reports a board thread with a null screen", async () => {
      openEditorWithThread("thread_open");
      mocks.getReviewThreadRoot.mockResolvedValue({
        ...rootComment,
        targetId: null,
        anchor: null,
        body: "x".repeat(500),
      });
      mocks.queryReviewComments.mockResolvedValue([]);

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread).toMatchObject({
        threadId: "thread_open",
        screenId: null,
        anchorNodeId: null,
        preview: "x".repeat(200),
      });
    });

    it("says the count is cut off when the lookup hit its cap", async () => {
      openEditorWithThread("thread_open");
      mocks.getReviewThreadRoot.mockResolvedValue(rootComment);
      mocks.queryReviewComments.mockImplementation(async () =>
        Array.from({ length: 500 }, (_, index) => ({
          ...rootComment,
          id: `comment_${index}`,
        })),
      );

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread).toMatchObject({
        commentCount: 500,
        commentCountTruncated: true,
      });
    });

    it("is unavailable, not null, when the thread is not found", async () => {
      openEditorWithThread("thread_gone");
      mocks.getReviewThreadRoot.mockResolvedValue(null);

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread).toEqual({
        threadId: "thread_gone",
        unavailable: true,
      });
    });

    it("is unavailable when the thread was deleted", async () => {
      openEditorWithThread("thread_open");
      mocks.getReviewThreadRoot.mockResolvedValue({
        ...rootComment,
        status: "deleted",
        deletedAt: "2026-06-29T00:00:00.000Z",
      });

      const result = JSON.parse(await action.run({}));

      expect(result.design.review.openThread).toEqual({
        threadId: "thread_open",
        unavailable: true,
      });
    });

    it("is unavailable, and logs, when the lookup throws", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        openEditorWithThread("thread_open");
        mocks.getReviewThreadRoot.mockRejectedValue(new Error("db down"));

        const result = JSON.parse(await action.run({}));

        expect(result.design.review.openThread).toEqual({
          threadId: "thread_open",
          unavailable: true,
        });
        expect(consoleError).toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
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
