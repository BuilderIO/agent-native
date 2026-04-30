import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

async function loadRetryJob() {
  vi.resetModules();
  return import("./pending-tasks-retry-job.js");
}

describe("pending task retry job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        sql: expect.stringContaining("SET status = ?, updated_at = ?"),
        args: ["pending", expect.any(Number), "task-processing"],
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
        sql: expect.stringContaining("SET status = 'failed'"),
        args: [
          expect.any(Number),
          "Retry job: exceeded 3 attempts",
          "task-exhausted",
        ],
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
