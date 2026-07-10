import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const isPostgresMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  isPostgres: isPostgresMock,
  intType: () => "INTEGER",
}));

async function loadStore() {
  vi.resetModules();
  return import("./pending-tasks-store.js");
}

describe("integration pending task store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPostgresMock.mockReturnValue(false);
  });

  it("claims pending tasks and increments attempts", async () => {
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT id, platform")) {
        return {
          rows: [
            {
              id: "task-1",
              platform: "slack",
              external_thread_id: "thread-1",
              payload: "{}",
              owner_email: "alice+qa@agent-native.test",
              org_id: null,
              status: "processing",
              attempts: 1,
              error_message: null,
              created_at: 1,
              updated_at: 2,
              completed_at: null,
            },
          ],
        };
      }
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [] };
    });

    const task = await claimPendingTask("task-1");

    expect(task?.id).toBe("task-1");
    const updateCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("UPDATE integration_pending_tasks");
    });
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE id = ? AND status = 'pending'"),
      }),
    );
  });

  it("does not claim terminal failed tasks", async () => {
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [], rowsAffected: 0 };
      }
      if (sql.includes("SELECT id, platform")) {
        return {
          rows: [
            {
              id: "task-failed",
              platform: "slack",
              external_thread_id: "thread-1",
              payload: "{}",
              owner_email: "alice+qa@agent-native.test",
              org_id: null,
              status: "failed",
              attempts: 3,
              error_message: "exceeded retries",
              created_at: 1,
              updated_at: 2,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(claimPendingTask("task-failed")).resolves.toBeNull();
  });

  it("returns null when a SQLite claim loses the conditional update race", async () => {
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [], rowsAffected: 0 };
      }
      if (sql.includes("SELECT id, platform")) {
        return {
          rows: [
            {
              id: "task-raced",
              platform: "slack",
              external_thread_id: "thread-1",
              payload: "{}",
              owner_email: "alice+qa@agent-native.test",
              org_id: null,
              status: "processing",
              attempts: 1,
              error_message: null,
              created_at: 1,
              updated_at: 2,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(claimPendingTask("task-raced")).resolves.toBeNull();

    const selectCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("SELECT id, platform");
    });
    expect(selectCall).toBeUndefined();
  });

  it("does not claim failed tasks on the Postgres RETURNING path", async () => {
    isPostgresMock.mockReturnValue(true);
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(claimPendingTask("task-failed")).resolves.toBeNull();

    const updateCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("UPDATE integration_pending_tasks");
    });
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE id = ? AND status = 'pending'"),
      }),
    );
  });

  it("only treats duplicate-key errors as duplicate webhook deliveries", async () => {
    const { isDuplicateEventError } = await loadStore();

    expect(
      isDuplicateEventError(
        new Error(
          "UNIQUE constraint failed: integration_pending_tasks.platform, integration_pending_tasks.external_event_key",
        ),
      ),
    ).toBe(true);
    expect(isDuplicateEventError({ code: "23505" })).toBe(true);
    expect(isDuplicateEventError(new Error("NOT NULL constraint failed"))).toBe(
      false,
    );
    expect(isDuplicateEventError(new Error("CHECK constraint failed"))).toBe(
      false,
    );
  });

  it("erases transient provider credentials from terminal task payloads", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { markTaskCompleted, markTaskFailed } = await loadStore();

    await markTaskCompleted("discord-task-completed");
    await markTaskFailed("discord-task-failed", "interaction expired");

    const terminalUpdates = executeMock.mock.calls
      .map(([query]) => query)
      .filter(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("UPDATE integration_pending_tasks"),
      );
    expect(terminalUpdates).toHaveLength(2);
    expect(terminalUpdates[0].sql).toContain("payload = ?");
    expect(terminalUpdates[0].args).toEqual([
      "completed",
      expect.any(Number),
      expect.any(Number),
      "{}",
      "discord-task-completed",
    ]);
    expect(terminalUpdates[1].args).toEqual([
      "failed",
      expect.any(Number),
      "interaction expired",
      "{}",
      "discord-task-failed",
    ]);
  });

  it("keeps the inbound payload when rescheduling a transient failure", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { markTaskRetryable } = await loadStore();

    await markTaskRetryable("discord-task-retry", "temporary provider error");

    const retryUpdate = executeMock.mock.calls
      .map(([query]) => query)
      .find(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("UPDATE integration_pending_tasks"),
      );
    expect(retryUpdate?.sql).toContain("status = ?");
    expect(retryUpdate?.sql).toContain("status = 'processing'");
    expect(retryUpdate?.sql).not.toContain("payload");
    expect(retryUpdate?.args).toEqual([
      "pending",
      expect.any(Number),
      "temporary provider error",
      "discord-task-retry",
    ]);
  });
});
