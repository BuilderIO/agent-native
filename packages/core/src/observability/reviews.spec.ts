import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveThreadAccess = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetFeedback = vi.hoisted(() => vi.fn());
const mockGetInstructionUpdates = vi.hoisted(() => vi.fn());

vi.mock("../chat-threads/store.js", () => ({
  resolveThreadAccess: (...args: unknown[]) => mockResolveThreadAccess(...args),
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
    mockResolveThreadAccess.mockResolvedValue({
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
    });
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

  it("does not return a thread owned by another user", async () => {
    mockResolveThreadAccess.mockResolvedValueOnce(null);
    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        userId: "alice@example.com",
      }),
    ).resolves.toEqual([]);
  });
});
