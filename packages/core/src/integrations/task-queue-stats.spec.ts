import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const ensureTableMock = vi.hoisted(() => vi.fn());
const ensureA2ATableMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

vi.mock("./pending-tasks-store.js", () => ({
  ensurePendingTasksTable: ensureTableMock,
}));

vi.mock("./a2a-continuations-store.js", () => ({
  ensureA2AContinuationsTable: ensureA2ATableMock,
}));

describe("integration task queue stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureTableMock.mockResolvedValue(undefined);
    ensureA2ATableMock.mockResolvedValue(undefined);
  });

  it("returns dispatch diagnostics without selecting payloads or user text", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ status: "pending", c: 1 }] })
      .mockResolvedValueOnce({ rows: [{ status: "completed", c: 2 }] })
      .mockResolvedValueOnce({ rows: [{ created_at: Date.now() - 5_000 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-1",
            platform: "slack",
            status: "pending",
            attempts: 0,
            dispatch_attempts: 2,
            last_dispatch_outcome: "portable-unconfirmed",
            created_at: Date.now() - 5_000,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            active_count: 2,
            oldest_created_at: Date.now() - 10_000,
            orphan_count: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "cont-orphan-1",
            integration_task_id: "task-1",
            status: "failed",
            attempts: 3,
            created_at: Date.now() - 15_000,
            error_message: "Slack delivery timed out",
          },
        ],
      });
    const { getTaskQueueStats } = await import("./task-queue-stats.js");

    const result = await getTaskQueueStats({
      ownerEmail: "alice@example.com",
      orgId: "org-a",
    });

    expect(ensureTableMock).toHaveBeenCalledOnce();
    expect(result.recent_tasks[0]).toEqual(
      expect.objectContaining({
        id: "task-1",
        platform: "slack",
        dispatch_attempts: 2,
        last_dispatch_outcome: "portable-unconfirmed",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        waiting_campaigns: 1,
        active_a2a_continuations: 2,
        terminal_a2a_without_delivery: 1,
      }),
    );
    expect(result.recent_a2a_orphans).toEqual([
      expect.objectContaining({
        continuation_id: "cont-orphan-1",
        integration_task_id: "task-1",
        reason_class: "timeout",
      }),
    ]);
    expect(ensureA2ATableMock).toHaveBeenCalledOnce();
    expect(ensureA2ATableMock.mock.invocationCallOrder[0]).toBeLessThan(
      executeMock.mock.invocationCallOrder[0],
    );
    const sql = executeMock.mock.calls
      .map(([query]) => (query as { sql: string }).sql)
      .join("\n");
    expect(sql).not.toMatch(/\bpayload\b|external_thread_id/i);
    for (const [query] of executeMock.mock.calls) {
      expect((query as { args: unknown[] }).args).toEqual(
        expect.arrayContaining(["alice@example.com", "org-a"]),
      );
    }
  });
});
