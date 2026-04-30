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
});
