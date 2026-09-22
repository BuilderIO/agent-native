import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  reap: vi.fn(),
  shouldRedispatch: vi.fn(),
  heartbeat: vi.fn(),
  dispatch: vi.fn(),
  dispatchPath: vi.fn(),
}));

vi.mock("../agent/run-store.js", () => ({
  UNCLAIMED_BACKGROUND_RUN_SWEEP_BATCH_LIMIT: 4,
  listUnclaimedBackgroundRunRows: mocks.list,
  reapUnclaimedBackgroundRun: mocks.reap,
  shouldRedispatchUnclaimedBackgroundRun: mocks.shouldRedispatch,
  updateRunHeartbeat: mocks.heartbeat,
}));

vi.mock("../agent/durable-background.js", () => ({
  AGENT_CHAT_BACKGROUND_RUN_FIELD: "backgroundRun",
  resolveAgentChatProcessRunDispatchPath: mocks.dispatchPath,
}));

vi.mock("./self-dispatch.js", () => ({
  fireInternalDispatch: mocks.dispatch,
}));

const { sweepUnclaimedBackgroundRuns } =
  await import("./unclaimed-background-runs.js");

describe("sweepUnclaimedBackgroundRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([]);
    mocks.reap.mockResolvedValue(false);
    mocks.shouldRedispatch.mockReturnValue(true);
    mocks.heartbeat.mockResolvedValue(undefined);
    mocks.dispatch.mockResolvedValue(undefined);
    mocks.dispatchPath.mockReturnValue(
      "/_agent-native/agent-chat/_process-run",
    );
  });

  it("redispatches a deferred successor with its durable payload marker", async () => {
    mocks.list.mockResolvedValue([
      { id: "run-deferred", startedAt: 100, hasDispatchPayload: true },
    ]);

    await expect(
      sweepUnclaimedBackgroundRuns({ now: 200, reapExpired: true }),
    ).resolves.toEqual({
      scanned: 1,
      attempted: 1,
      redispatched: 1,
      reaped: 0,
      failed: 0,
      truncated: false,
    });

    expect(mocks.list).toHaveBeenCalledWith({ limit: 5 });
    expect(mocks.heartbeat).toHaveBeenCalledWith("run-deferred");
    expect(mocks.dispatch).toHaveBeenCalledWith({
      path: "/_agent-native/agent-chat/_process-run",
      taskId: "run-deferred",
      body: {
        internalContinuation: true,
        backgroundRun: { runId: "run-deferred", payloadRef: true },
      },
      awaitResponse: true,
      responseTimeoutMs: 15_000,
    });
    expect(mocks.reap).not.toHaveBeenCalled();
  });

  it("reaps payload-less and expired rows only when requested", async () => {
    mocks.list.mockResolvedValue([
      { id: "run-no-payload", startedAt: 100, hasDispatchPayload: false },
      { id: "run-expired", startedAt: 100, hasDispatchPayload: true },
    ]);
    mocks.shouldRedispatch.mockReturnValue(false);
    mocks.reap.mockResolvedValue(true);

    await expect(
      sweepUnclaimedBackgroundRuns({ now: 10_000, reapExpired: true }),
    ).resolves.toMatchObject({
      scanned: 2,
      attempted: 0,
      redispatched: 0,
      reaped: 2,
      failed: 0,
      truncated: false,
    });
    expect(mocks.reap).toHaveBeenNthCalledWith(1, "run-no-payload");
    expect(mocks.reap).toHaveBeenNthCalledWith(2, "run-expired");
  });

  it("keeps dispatch failure visible in the sweep result", async () => {
    mocks.list.mockResolvedValue([
      { id: "run-failed", startedAt: 100, hasDispatchPayload: true },
    ]);
    mocks.dispatch.mockRejectedValue(new Error("dispatch unavailable"));

    await expect(
      sweepUnclaimedBackgroundRuns({ now: 200 }),
    ).resolves.toMatchObject({
      scanned: 1,
      attempted: 1,
      redispatched: 0,
      reaped: 0,
      failed: 1,
      truncated: false,
    });
  });

  it("reports a bounded sweep when more rows remain", async () => {
    mocks.list.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `run-${index}`,
        startedAt: index,
        hasDispatchPayload: false,
      })),
    );
    mocks.reap.mockResolvedValue(true);

    await expect(
      sweepUnclaimedBackgroundRuns({ reapExpired: true }),
    ).resolves.toMatchObject({
      scanned: 4,
      reaped: 4,
      truncated: true,
    });
    expect(mocks.reap).toHaveBeenCalledTimes(4);
  });
});
