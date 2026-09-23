import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveThreadsAccess = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetFeedback = vi.hoisted(() => vi.fn());
const mockGetInstructionUpdates = vi.hoisted(() => vi.fn());

vi.mock("../chat-threads/store.js", () => ({
  resolveThreadsAccess: (...args: unknown[]) =>
    mockResolveThreadsAccess(...args),
}));

vi.mock("./store.js", () => ({
  getTraceSummaries: (...args: unknown[]) => mockGetTraceSummaries(...args),
  getFeedback: (...args: unknown[]) => mockGetFeedback(...args),
  getInstructionUpdates: (...args: unknown[]) =>
    mockGetInstructionUpdates(...args),
}));

import { listOutputReviews } from "./reviews.js";

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

    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        userId: "alice@example.com",
      }),
    ).resolves.toMatchObject([
      {
        ask: "Show a chart",
        answer: "Here is the chart.",
        inlineApp: {
          serverId: "analytics",
          resource: {
            mimeType: "text/html;profile=mcp-app",
            text: "<html><body>Chart</body></html>",
          },
        },
      },
    ]);
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
});
