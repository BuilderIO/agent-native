import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

vi.mock("../server/core-routes-plugin.js", () => ({
  FRAMEWORK_ROUTE_PREFIX: "/_agent-native",
}));

async function loadRetryJob() {
  vi.resetModules();
  return import("./pending-tasks-retry-job.js");
}

describe("pending task retry job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
  });

  it("resets stuck processing tasks to pending and re-fires the processor", async () => {
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [{ id: "task-processing", status: "processing", attempts: 1 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await retryStuckPendingTasks("https://app.test");

    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining("AND status = ?"),
        args: ["pending", expect.any(Number), "task-processing", "processing"],
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://app.test/_agent-native/integrations/process-task",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "task-processing" }),
      }),
    );
  });

  it("marks tasks failed after the retry cap without re-firing", async () => {
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [{ id: "task-exhausted", status: "pending", attempts: 3 }],
      })
      .mockResolvedValueOnce({ rows: [] });

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
        ],
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
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
        args: [Date.now() - 90_000, Date.now() - 75_000],
      }),
    );
    vi.useRealTimers();
  });

  it("uses status-guarded updates so stale retry sweeps cannot clobber completed tasks", async () => {
    const { retryStuckPendingTasks } = await loadRetryJob();
    executeMock
      .mockResolvedValueOnce({
        rows: [
          { id: "task-stale-pending", status: "pending", attempts: 1 },
          { id: "task-stale-processing", status: "processing", attempts: 3 },
        ],
      })
      .mockResolvedValue({ rows: [] });

    await retryStuckPendingTasks("https://app.test");

    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining("AND status = ?"),
        args: ["pending", expect.any(Number), "task-stale-pending", "pending"],
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
        ],
      }),
    );
  });
});
