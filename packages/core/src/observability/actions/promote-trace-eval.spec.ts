import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getTraceSummary: vi.fn(),
  getTraceSpansForRun: vi.fn(),
  insertEvalDataset: vi.fn(),
}));
const runStore = vi.hoisted(() => ({
  getRunById: vi.fn(),
  getRunEventsSince: vi.fn(),
}));
const threads = vi.hoisted(() => ({
  getThread: vi.fn(async () => null as { threadData?: string } | null),
}));

vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({ execute: vi.fn() }),
}));
vi.mock("../store.js", () => ({
  getTraceSummary: (...a: unknown[]) => store.getTraceSummary(...a),
  getTraceSpansForRun: (...a: unknown[]) => store.getTraceSpansForRun(...a),
  insertEvalDataset: (...a: unknown[]) => store.insertEvalDataset(...a),
}));
vi.mock("../../agent/run-store.js", () => ({
  getRunById: (...a: unknown[]) => runStore.getRunById(...a),
  getRunEventsSince: (...a: unknown[]) => runStore.getRunEventsSince(...a),
}));
vi.mock("../../chat-threads/store.js", () => ({
  getThread: (...a: unknown[]) => threads.getThread(...a),
}));

const promoteTraceEval = (await import("./promote-trace-eval.js")).default;
const { promoteTraceEvalFromStore } = await import("./promote-trace-eval.js");
const { ActionContractError } = await import("../../action.js");

function completedRun() {
  return {
    id: "run-1",
    threadId: "thread-1",
    status: "completed",
    startedAt: 1,
    errorCode: null,
    errorDetail: null,
    terminalReason: null,
  };
}

function summary(userId = "alice@example.com") {
  return {
    runId: "run-1",
    threadId: "thread-1",
    userId,
    totalSpans: 2,
    llmCalls: 1,
    toolCalls: 1,
    successfulTools: 1,
    failedTools: 0,
    totalDurationMs: 10,
    totalCostCentsX100: 1,
    totalInputTokens: 1,
    totalOutputTokens: 1,
    model: "test-model",
    createdAt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  threads.getThread.mockResolvedValue(null);
  store.insertEvalDataset.mockResolvedValue(undefined);
  store.getTraceSpansForRun.mockResolvedValue([
    {
      id: "s1",
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
      parentSpanId: null,
      spanType: "tool_call",
      name: "search-docs",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costCentsX100: 0,
      durationMs: 1,
      status: "success",
      errorMessage: null,
      metadata: null,
      createdAt: 1,
    },
  ]);
  runStore.getRunEventsSince.mockResolvedValue([
    {
      seq: 1,
      eventData: JSON.stringify({
        type: "user-message",
        text: "Search the docs",
      }),
    },
    {
      seq: 2,
      eventData: JSON.stringify({
        type: "tool_done",
        tool: "search-docs",
        result: "ok",
      }),
    },
  ]);
});

describe("promote-trace-eval", () => {
  it("inserts one dataset for a completed owned run", async () => {
    store.getTraceSummary.mockResolvedValue(summary());
    runStore.getRunById.mockResolvedValue(completedRun());

    const result = await promoteTraceEval.run(
      { runId: "run-1" },
      { userEmail: "alice@example.com" },
    );

    expect(store.getTraceSummary).toHaveBeenCalledWith("run-1", {
      userId: "alice@example.com",
    });
    expect(store.insertEvalDataset).toHaveBeenCalledTimes(1);
    const dataset = store.insertEvalDataset.mock.calls[0]![0];
    expect(dataset.userId).toBe("alice@example.com");
    expect(dataset.entries).toHaveLength(1);
    expect(result.eval.scorers).toEqual([
      { type: "usesTool", toolName: "search-docs" },
    ]);
    expect(result.sourceRunId).toBe("run-1");
  });

  it("promotes the durable thread prompt when events have no user-message", async () => {
    store.getTraceSummary.mockResolvedValue(summary());
    runStore.getRunById.mockResolvedValue(completedRun());
    runStore.getRunEventsSince.mockResolvedValue([
      {
        seq: 1,
        eventData: JSON.stringify({
          type: "tool_done",
          tool: "search-docs",
          result: "ok",
        }),
      },
      { seq: 2, eventData: JSON.stringify({ type: "text", text: "Done." }) },
      { seq: 3, eventData: JSON.stringify({ type: "done" }) },
    ]);
    threads.getThread.mockResolvedValue({
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              id: "server-user-run-1",
              role: "user",
              content: [{ type: "text", text: "Search the docs" }],
              metadata: { custom: { submittedRunId: "run-1" } },
            },
            parentId: null,
          },
        ],
      }),
    });

    const result = await promoteTraceEval.run(
      { runId: "run-1" },
      { userEmail: "alice@example.com" },
    );

    expect(threads.getThread).toHaveBeenCalledWith("thread-1");
    expect(result.eval.input.prompt).toBe("Search the docs");
    expect(store.insertEvalDataset).toHaveBeenCalledTimes(1);
  });

  it("returns not_found for another user's runId", async () => {
    store.getTraceSummary.mockResolvedValue(null);

    await expect(
      promoteTraceEval.run(
        { runId: "run-1" },
        { userEmail: "alice@example.com" },
      ),
    ).rejects.toMatchObject({
      errorCode: "not_found",
      statusCode: 404,
    });
    expect(store.insertEvalDataset).not.toHaveBeenCalled();
    expect(runStore.getRunById).not.toHaveBeenCalled();
  });

  it("returns run_not_completed for a truncated run", async () => {
    store.getTraceSummary.mockResolvedValue(summary());
    runStore.getRunById.mockResolvedValue({
      ...completedRun(),
      status: "truncated",
    });

    await expect(
      promoteTraceEval.run(
        { runId: "run-1" },
        { userEmail: "alice@example.com" },
      ),
    ).rejects.toBeInstanceOf(ActionContractError);

    await expect(
      promoteTraceEval.run(
        { runId: "run-1" },
        { userEmail: "alice@example.com" },
      ),
    ).rejects.toMatchObject({
      errorCode: "run_not_completed",
      statusCode: 409,
    });
    expect(store.insertEvalDataset).not.toHaveBeenCalled();
  });

  it("promoteTraceEvalFromStore inserts nothing when mapping fails", async () => {
    store.getTraceSummary.mockResolvedValue(summary());
    runStore.getRunById.mockResolvedValue(completedRun());
    runStore.getRunEventsSince.mockResolvedValue([]);
    store.getTraceSpansForRun.mockResolvedValue([]);

    await expect(
      promoteTraceEvalFromStore(
        { runId: "run-1" },
        { userId: "alice@example.com" },
      ),
    ).rejects.toMatchObject({ errorCode: "no_user_prompt" });
    expect(store.insertEvalDataset).not.toHaveBeenCalled();
  });
});
