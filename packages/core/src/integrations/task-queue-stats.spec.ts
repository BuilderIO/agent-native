import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const ensureTableMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

vi.mock("./pending-tasks-store.js", () => ({
  ensurePendingTasksTable: ensureTableMock,
}));

describe("integration task queue stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureTableMock.mockResolvedValue(undefined);
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
