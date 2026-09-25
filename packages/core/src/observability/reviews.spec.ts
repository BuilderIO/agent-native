import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveThreadsAccess = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetTraceSummary = vi.hoisted(() => vi.fn());
const mockGetFeedback = vi.hoisted(() => vi.fn());
const mockGetInstructionUpdates = vi.hoisted(() => vi.fn());

vi.mock("../chat-threads/store.js", () => ({
  resolveThreadsAccess: (...args: unknown[]) =>
    mockResolveThreadsAccess(...args),
}));

vi.mock("./store.js", () => ({
  getTraceSummaries: (...args: unknown[]) => mockGetTraceSummaries(...args),
  getTraceSummary: (...args: unknown[]) => mockGetTraceSummary(...args),
  getFeedback: (...args: unknown[]) => mockGetFeedback(...args),
  getInstructionUpdates: (...args: unknown[]) =>
    mockGetInstructionUpdates(...args),
}));

import getObservabilityReviewApp from "./actions/get-observability-review-app.js";
import getObservabilityReviewDetail from "./actions/get-observability-review-detail.js";
import { getOutputReviewDetailForRun, listOutputReviews } from "./reviews.js";

describe("listOutputReviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTraceSummaries.mockResolvedValue([
      {
        runId: "run-1",
        threadId: "thread-1",
        model: "test-model",
        createdAt: 123,
      },
    ]);
    mockGetTraceSummary.mockResolvedValue(null);
    mockGetFeedback.mockResolvedValue([
      {
        id: "feedback-1",
        runId: "run-1",
        threadId: "thread-1",
        feedbackType: "text",
        value: "Keep the concise format",
        createdAt: 124,
      },
    ]);
    mockGetInstructionUpdates.mockResolvedValue([]);
    mockResolveThreadsAccess.mockResolvedValue(
      new Map([
        [
          "thread-1",
          {
            ownerEmail: "alice@example.com",
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: [{ type: "text", text: "Summarize this" }],
                    metadata: { custom: { submittedRunId: "run-1" } },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "Here is the summary." }],
                    metadata: { runId: "run-1" },
                  },
                },
              ],
            }),
          },
        ],
      ]),
    );
  });

  it("pairs a run's ask and answer and groups human feedback", async () => {
    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        userId: "alice@example.com",
      }),
    ).resolves.toMatchObject([
      {
        runId: "run-1",
        ask: "Summarize this",
        answer: "Here is the summary.",
        hasInlineApp: false,
        feedback: [{ value: "Keep the concise format" }],
      },
    ]);
  });

  it("keeps a saved inline MCP App with its run's answer", async () => {
    mockResolveThreadsAccess.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          {
            ownerEmail: "alice@example.com",
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: [{ type: "text", text: "Show a chart" }],
                    metadata: { custom: { submittedRunId: "run-1" } },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [
                      { type: "text", text: "Here is the chart." },
                      {
                        type: "tool-call",
                        mcpApp: {
                          serverId: "analytics",
                          toolName: "chart",
                          originalToolName: "chart",
                          resourceUri: "ui://chart",
                          toolInput: {},
                          toolResult: {},
                          tool: {
                            name: "chart-tool",
                            title: `Chart ${"x".repeat(140)}`,
                          },
                          resource: {
                            uri: "ui://chart",
                            mimeType: "text/html;profile=mcp-app",
                            text: "<html><body>Chart</body></html>",
                          },
                        },
                      },
                    ],
                    metadata: { runId: "run-1" },
                  },
                },
              ],
            }),
          },
        ],
      ]),
    );

    const rows = await listOutputReviews({
      sinceMs: 0,
      limit: 10,
      userId: "alice@example.com",
    });
    expect(rows).toMatchObject([
      {
        ask: "Show a chart",
        answer: "Here is the chart.",
        hasInlineApp: true,
        inlineAppTitle: `Chart ${"x".repeat(114)}`,
      },
    ]);
    expect(rows[0]).not.toHaveProperty("inlineApp");
  });

  it("fetches one saved app through the caller-scoped run and thread", async () => {
    const app = {
      serverId: "analytics",
      toolName: "chart",
      originalToolName: "chart",
      resourceUri: "ui://chart",
      toolInput: { range: "week" },
      toolResult: { total: 12 },
      resource: {
        uri: "ui://chart",
        mimeType: "text/html;profile=mcp-app",
        text: "<html><body>Chart</body></html>",
      },
    };
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
    });
    mockResolveThreadsAccess.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          {
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: "Show a chart",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "tool-call",
                        mcpApp: app,
                      },
                    ],
                    metadata: { runId: "run-1" },
                  },
                },
              ],
            }),
          },
        ],
      ]),
    );

    await expect(
      getObservabilityReviewApp.run({ runId: "run-1" }, {
        userEmail: "alice@example.com",
      } as any),
    ).resolves.toEqual(app);
    expect(mockGetTraceSummary).toHaveBeenCalledWith("run-1", {
      userId: "alice@example.com",
    });
    expect(mockResolveThreadsAccess).toHaveBeenCalledWith("alice@example.com", [
      "thread-1",
    ]);
  });

  it("returns null when the run has no saved app and fails closed on inaccessible threads", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: null,
    });
    await expect(
      getObservabilityReviewApp.run({ runId: "run-1" }, {
        userEmail: "alice@example.com",
      } as any),
    ).resolves.toBeNull();
    expect(mockResolveThreadsAccess).not.toHaveBeenCalled();

    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-2",
      threadId: "private-thread",
    });
    mockResolveThreadsAccess.mockResolvedValueOnce(new Map());
    await expect(
      getObservabilityReviewApp.run({ runId: "run-2" }, {
        userEmail: "alice@example.com",
      } as any),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("requires a signed-in user to fetch a saved app", async () => {
    await expect(
      getObservabilityReviewApp.run({ runId: "run-1" }, {} as any),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
  });

  it("does not return a thread owned by another user", async () => {
    mockResolveThreadsAccess.mockResolvedValueOnce(new Map());
    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        userId: "alice@example.com",
      }),
    ).resolves.toEqual([]);
  });

  it("does not cross-pair an unmatched run with another ask and answer", async () => {
    mockGetTraceSummaries.mockResolvedValueOnce([
      {
        runId: "run-missing",
        threadId: "thread-1",
        model: "test-model",
        createdAt: 123,
      },
    ]);
    mockResolveThreadsAccess.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          {
            ownerEmail: "alice@example.com",
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: "First ask",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: "First answer",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "user",
                    content: "Second ask",
                    metadata: { runId: "run-2" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: "Second answer",
                    metadata: { runId: "run-2" },
                  },
                },
              ],
            }),
          },
        ],
      ]),
    );

    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        userId: "alice@example.com",
      }),
    ).resolves.toMatchObject([{ ask: "", answer: "" }]);
  });

  it("loads the full text transcript for an accessible run", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
    });
    mockResolveThreadsAccess.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          {
            threadData: JSON.stringify({
              messages: [
                { message: { role: "user", content: "First question" } },
                { message: { role: "assistant", content: "First answer" } },
                { message: { role: "user", content: "Follow-up" } },
                { message: { role: "assistant", content: "Final answer" } },
              ],
            }),
          },
        ],
      ]),
    );

    await expect(
      getObservabilityReviewDetail.run({ runId: "run-1" }, {
        userEmail: "alice@example.com",
      } as any),
    ).resolves.toEqual({
      app: null,
      messages: [
        { role: "user", text: "First question" },
        { role: "assistant", text: "First answer" },
        { role: "user", text: "Follow-up" },
        { role: "assistant", text: "Final answer" },
      ],
    });
    expect(mockGetTraceSummary).toHaveBeenCalledWith("run-1", {
      userId: "alice@example.com",
    });
    expect(mockResolveThreadsAccess).toHaveBeenCalledWith("alice@example.com", [
      "thread-1",
    ]);
  });

  it("returns an empty detail for a run without a thread and hides inaccessible runs", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: null,
    });
    await expect(
      getOutputReviewDetailForRun({
        runId: "run-1",
        userId: "alice@example.com",
      }),
    ).resolves.toEqual({ found: true, app: null, messages: [] });
    expect(mockResolveThreadsAccess).not.toHaveBeenCalled();

    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-2",
      threadId: "private-thread",
    });
    mockResolveThreadsAccess.mockResolvedValueOnce(new Map());
    await expect(
      getObservabilityReviewDetail.run({ runId: "run-2" }, {
        userEmail: "alice@example.com",
      } as any),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("requires a signed-in user to load a review detail", async () => {
    await expect(
      getObservabilityReviewDetail.run({ runId: "run-1" }, {} as any),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
  });
});
