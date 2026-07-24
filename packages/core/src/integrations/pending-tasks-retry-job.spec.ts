import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const dispatchPendingTaskMock = vi.hoisted(() =>
  vi.fn(async () => "background-acknowledged"),
);
const durableEnabledMock = vi.hoisted(() => vi.fn(() => true));
const configuredScopesMock = vi.hoisted(() => vi.fn(() => null));
const ensurePendingTasksTableMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

vi.mock("../server/core-routes-plugin.js", () => ({
  FRAMEWORK_ROUTE_PREFIX: "/_agent-native",
}));

vi.mock("./pending-tasks-store.js", () => ({
  ensurePendingTasksTable: ensurePendingTasksTableMock,
  MAX_PENDING_TASK_ATTEMPTS: 3,
}));

vi.mock("./integration-durable-dispatch.js", () => ({
  configuredIntegrationDurableDispatchScopes: configuredScopesMock,
  dispatchPendingIntegrationTask: dispatchPendingTaskMock,
  isIntegrationDurableDispatchEnabledForTask: durableEnabledMock,
}));

async function loadRetryJob() {
  vi.resetModules();
  return import("./pending-tasks-retry-job.js");
}

describe("pending task retry job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    dispatchPendingTaskMock.mockResolvedValue("background-acknowledged");
    durableEnabledMock.mockReturnValue(true);
    configuredScopesMock.mockReturnValue(null);
    ensurePendingTasksTableMock.mockResolvedValue(undefined);
  });

  it("resets stuck processing tasks to pending and re-fires the processor", async () => {
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-processing",
            platform: "slack",
            external_thread_id: "slack:team:C123:1",
            status: "processing",
            attempts: 1,
            updated_at: 10,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await retryStuckPendingTasks("https://app.test");

    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining("AND status = ?"),
        args: [
          "pending",
          expect.any(Number),
          "task-processing",
          "processing",
          10,
        ],
      }),
    );
    expect(dispatchPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-processing",
        baseUrl: "https://app.test",
      }),
    );
    expect(ensurePendingTasksTableMock).toHaveBeenCalledOnce();
  });

  it("fails loud when the additive queue schema cannot be ensured", async () => {
    ensurePendingTasksTableMock.mockRejectedValueOnce(
      new Error("migration lock timeout"),
    );
    const { retryStuckPendingTasks } = await loadRetryJob();

    await expect(retryStuckPendingTasks()).rejects.toThrow(
      "migration lock timeout",
    );
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("does not misclassify query failures as a missing queue table", async () => {
    executeMock.mockRejectedValueOnce(new Error("permission denied"));
    const { retryStuckPendingTasks } = await loadRetryJob();

    await expect(retryStuckPendingTasks()).rejects.toThrow("permission denied");
  });

  it("marks tasks failed after the retry cap without re-firing", async () => {
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-exhausted",
            platform: "slack",
            external_thread_id: "slack:team:C123:1",
            status: "pending",
            attempts: 3,
            updated_at: 20,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await retryStuckPendingTasks("https://app.test");

    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining("AND status = ?"),
        args: [
          expect.any(Number),
          "Retry job: exceeded 3 attempts",
          "task-exhausted",
          "pending",
          20,
        ],
      }),
    );
    expect((executeMock.mock.calls[1]?.[0] as { sql: string }).sql).toContain(
      "payload = '{}'",
    );
    expect((executeMock.mock.calls[1]?.[0] as { sql: string }).sql).toContain(
      "external_event_key = NULL",
    );
    expect(dispatchPendingTaskMock).not.toHaveBeenCalled();
  });

  it("uses a shorter processing-stuck cutoff on serverless hosts", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T04:00:00.000Z"));
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock.mockResolvedValueOnce({ rows: [] });

    await retryStuckPendingTasks("https://app.test");

    expect(executeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        args: [
          Date.now() - 90_000,
          Date.now() - 90_000,
          Date.now() - 16 * 60_000,
          Date.now() - 75_000,
          100,
        ],
      }),
    );
    vi.useRealTimers();
  });

  it("uses status-guarded updates so stale retry sweeps cannot clobber completed tasks", async () => {
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-stale-pending",
            platform: "slack",
            external_thread_id: "slack:team:C123:1",
            status: "pending",
            attempts: 1,
            updated_at: 30,
          },
          {
            id: "task-stale-processing",
            platform: "slack",
            external_thread_id: "slack:team:C123:1",
            status: "processing",
            attempts: 3,
            updated_at: 40,
          },
        ],
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    await retryStuckPendingTasks("https://app.test");

    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining("AND status = ?"),
        args: [
          "pending",
          expect.any(Number),
          "task-stale-pending",
          "pending",
          30,
        ],
      }),
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        sql: expect.stringContaining("AND status = ?"),
        args: [
          expect.any(Number),
          "Retry job: exceeded 3 attempts",
          "task-stale-processing",
          "processing",
          40,
        ],
      }),
    );
    expect(dispatchPendingTaskMock).not.toHaveBeenCalled();
  });

  it("pushes durable rollout scopes into the bounded SQL selection", async () => {
    configuredScopesMock.mockReturnValue([
      { platform: "slack", value: "C123" },
    ]);
    durableEnabledMock.mockImplementation(({ externalThreadId }) =>
      externalThreadId.includes(":C123:"),
    );
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "enabled-task",
            platform: "slack",
            external_thread_id: "A1:T1:C123:1.0",
            status: "pending",
            attempts: 0,
            updated_at: 60,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await retryStuckPendingTasks({
      webhookBaseUrl: "https://app.test",
      durableOnly: true,
      limit: 1,
    });

    const select = executeMock.mock.calls[0]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(select.sql).toContain("external_thread_id LIKE ?");
    expect(select.args.slice(-5)).toEqual([
      "slack",
      "C123",
      "C123",
      "%:%:C123:%",
      1,
    ]);
    expect(result).toEqual({
      selected: 1,
      dispatched: 1,
      markedFailed: 0,
      skipped: 0,
      dispatchFailed: 0,
    });
    expect(dispatchPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "enabled-task" }),
    );
  });

  it("preserves a non-Slack channel scope through durable recovery", async () => {
    configuredScopesMock.mockReturnValue([
      { platform: "microsoft-teams", value: "channel-7" },
    ]);
    durableEnabledMock.mockImplementation(
      ({ platformContext }) => platformContext?.channelId === "channel-7",
    );
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "teams-task",
            platform: "microsoft-teams",
            external_thread_id: "conversation-9",
            dispatch_scope: "channel-7",
            status: "pending",
            attempts: 0,
            updated_at: 60,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await retryStuckPendingTasks({
      webhookBaseUrl: "https://app.test",
      durableOnly: true,
      limit: 1,
    });

    const select = executeMock.mock.calls[0]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(select.sql).toContain("dispatch_scope = ?");
    expect(select.args.slice(-4)).toEqual([
      "microsoft-teams",
      "channel-7",
      "channel-7",
      1,
    ]);
    expect(result.dispatched).toBe(1);
    expect(dispatchPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "teams-task",
        task: expect.objectContaining({
          platformContext: { channelId: "channel-7" },
        }),
      }),
    );
  });

  it("does not reclaim a healthy durable background task at the synchronous cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock.mockResolvedValueOnce({ rows: [] });

    const result = await retryStuckPendingTasks();

    expect(result.selected).toBe(0);
    const select = executeMock.mock.calls[0]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(select.sql).toContain(
      "last_dispatch_outcome = 'background-acknowledged'",
    );
    expect(select.args).toContain(Date.now() - 16 * 60_000);
    expect(executeMock).toHaveBeenCalledOnce();
    expect(dispatchPendingTaskMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
