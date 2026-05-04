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
  return import("./store.js");
}

describe("agent run continuations store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPostgresMock.mockReturnValue(false);
  });

  it("enqueues a continuation row with status=pending and attempts=0", async () => {
    const { enqueueRunContinuation } = await loadStore();
    executeMock.mockResolvedValue({ rows: [] });

    await enqueueRunContinuation({
      id: "cont-1",
      threadId: "thread-1",
      parentRunId: "run-1",
      ownerEmail: "alice+qa@agent-native.test",
      orgId: null,
    });

    const insertCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("INSERT INTO agent_run_continuations");
    });
    expect(insertCall).toBeDefined();
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining([
          "cont-1",
          "thread-1",
          "run-1",
          "alice+qa@agent-native.test",
          null,
          "pending",
          0,
        ]),
      }),
    );
  });

  it("claims pending continuations and increments attempts (SQLite re-read)", async () => {
    const { claimRunContinuation } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT id, thread_id")) {
        return {
          rows: [
            {
              id: "cont-1",
              thread_id: "thread-1",
              parent_run_id: "run-1",
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
      if (sql.includes("UPDATE agent_run_continuations")) {
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [] };
    });

    const cont = await claimRunContinuation("cont-1");

    expect(cont?.id).toBe("cont-1");
    expect(cont?.status).toBe("processing");
    expect(cont?.attempts).toBe(1);
    const updateCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("UPDATE agent_run_continuations");
    });
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE id = ? AND status = 'pending'"),
      }),
    );
  });

  it("returns null when SQLite claim loses the conditional-update race", async () => {
    const { claimRunContinuation } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE agent_run_continuations")) {
        return { rows: [], rowsAffected: 0 };
      }
      // Even though a re-read would show the row, the rowsAffected=0 short-
      // circuit must prevent us from reading it (we lost the race).
      return { rows: [] };
    });

    await expect(claimRunContinuation("cont-raced")).resolves.toBeNull();

    const selectCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("SELECT id, thread_id");
    });
    expect(selectCall).toBeUndefined();
  });

  it("uses Postgres RETURNING when isPostgres()=true", async () => {
    isPostgresMock.mockReturnValue(true);
    const { claimRunContinuation } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE agent_run_continuations")) {
        return {
          rows: [
            {
              id: "cont-pg",
              thread_id: "thread-1",
              parent_run_id: "run-1",
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

    const cont = await claimRunContinuation("cont-pg");
    expect(cont?.id).toBe("cont-pg");

    const updateCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("UPDATE agent_run_continuations");
    });
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("RETURNING"),
      }),
    );
  });

  it("does not re-claim a row already in a terminal state", async () => {
    const { claimRunContinuation } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE agent_run_continuations")) {
        // The conditional WHERE status='pending' is what filters out
        // 'completed' / 'failed' / 'gave_up' rows — the executor reports 0.
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [] };
    });

    await expect(claimRunContinuation("cont-done")).resolves.toBeNull();
  });

  it("marks completed and failed and gave_up with terminal updates", async () => {
    const {
      markRunContinuationCompleted,
      markRunContinuationFailed,
      markRunContinuationGaveUp,
    } = await loadStore();
    executeMock.mockResolvedValue({ rows: [] });

    await markRunContinuationCompleted("cont-1");
    await markRunContinuationFailed("cont-2", "boom");
    await markRunContinuationGaveUp("cont-3", "exceeded 3 attempts");

    const completedCall = executeMock.mock.calls.find(([q]) => {
      const args = (q as { args?: unknown[] }).args ?? [];
      return args[0] === "completed";
    });
    expect(completedCall).toBeDefined();

    const failedCall = executeMock.mock.calls.find(([q]) => {
      const args = (q as { args?: unknown[] }).args ?? [];
      return args[0] === "failed" && args[2] === "boom";
    });
    expect(failedCall).toBeDefined();

    const gaveUpCall = executeMock.mock.calls.find(([q]) => {
      const args = (q as { args?: unknown[] }).args ?? [];
      return args[0] === "gave_up" && args[2] === "exceeded 3 attempts";
    });
    expect(gaveUpCall).toBeDefined();
  });

  it("getActiveRunContinuationForThread returns the most recent in-flight row", async () => {
    const { getActiveRunContinuationForThread } = await loadStore();
    executeMock.mockResolvedValue({
      rows: [
        {
          id: "cont-active",
          thread_id: "thread-1",
          parent_run_id: "run-1",
          owner_email: "alice+qa@agent-native.test",
          org_id: null,
          status: "pending",
          attempts: 1,
          error_message: null,
          created_at: 1,
          updated_at: 2,
          completed_at: null,
        },
      ],
    });

    const cont = await getActiveRunContinuationForThread("thread-1");
    expect(cont?.id).toBe("cont-active");

    const selectCall = executeMock.mock.calls.find(([q]) => {
      const sql = typeof q === "string" ? q : q.sql;
      return (
        sql.includes("FROM agent_run_continuations") &&
        sql.includes("thread_id = ?") &&
        sql.includes("status IN")
      );
    });
    expect(selectCall).toBeDefined();
  });

  it("getActiveRunContinuationForThread returns null when no in-flight row", async () => {
    const { getActiveRunContinuationForThread } = await loadStore();
    executeMock.mockResolvedValue({ rows: [] });

    await expect(
      getActiveRunContinuationForThread("thread-empty"),
    ).resolves.toBeNull();
  });
});
