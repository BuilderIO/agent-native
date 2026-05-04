import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  isPostgres: () => false,
  intType: () => "INTEGER",
}));

vi.mock("./dispatch.js", () => ({
  RUN_CONTINUATION_PROCESSOR_PATH: "/_agent-native/runs/_continue-run",
  dispatchRunContinuation: fetchMock,
}));

async function loadRetryJob() {
  vi.resetModules();
  return import("./retry-job.js");
}

describe("run-continuations retry job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).NETLIFY;
  });

  it("re-fires dispatch for a stuck pending row and bumps updated_at", async () => {
    executeMock.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT id, status, attempts")) {
        return {
          rows: [
            {
              id: "cont-stuck",
              status: "pending",
              attempts: 1,
            },
          ],
        };
      }
      return { rows: [], rowsAffected: 1 };
    });

    const { retryStuckRunContinuations } = await loadRetryJob();
    await retryStuckRunContinuations();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("cont-stuck", expect.anything());

    // Pending rows get a touch on updated_at — same status, new updated_at —
    // so the next sweep tick doesn't immediately re-fire them.
    const touchCall = executeMock.mock.calls.find(([q]) => {
      const sql = typeof q === "string" ? q : q.sql;
      const args = (q as { args?: unknown[] }).args ?? [];
      return (
        sql.includes("UPDATE agent_run_continuations") && args[0] === "pending"
      );
    });
    expect(touchCall).toBeDefined();
  });

  it("resets a stuck processing row back to pending so atomic claim can win", async () => {
    executeMock.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT id, status, attempts")) {
        return {
          rows: [
            {
              id: "cont-frozen",
              status: "processing",
              attempts: 1,
            },
          ],
        };
      }
      return { rows: [], rowsAffected: 1 };
    });

    const { retryStuckRunContinuations } = await loadRetryJob();
    await retryStuckRunContinuations();

    const resetCall = executeMock.mock.calls.find(([q]) => {
      const args = (q as { args?: unknown[] }).args ?? [];
      // Reset: status was 'processing', new status arg is 'pending'
      return args[0] === "pending" && args[3] === "processing";
    });
    expect(resetCall).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks a row gave_up after MAX_ATTEMPTS and stops dispatching", async () => {
    executeMock.mockImplementation(async (query: any) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT id, status, attempts")) {
        return {
          rows: [
            {
              id: "cont-exhausted",
              status: "pending",
              attempts: 3, // already at MAX_ATTEMPTS
            },
          ],
        };
      }
      return { rows: [], rowsAffected: 1 };
    });

    const { retryStuckRunContinuations } = await loadRetryJob();
    await retryStuckRunContinuations();

    expect(fetchMock).not.toHaveBeenCalled();
    const gaveUpCall = executeMock.mock.calls.find(([q]) => {
      const args = (q as { args?: unknown[] }).args ?? [];
      return args[0] === "gave_up";
    });
    expect(gaveUpCall).toBeDefined();
  });

  it("no-ops when the table doesn't exist yet", async () => {
    executeMock.mockImplementation(async () => {
      throw new Error("no such table: agent_run_continuations");
    });

    const { retryStuckRunContinuations } = await loadRetryJob();
    await expect(retryStuckRunContinuations()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses 75s processing-stuck threshold on Netlify", async () => {
    process.env.NETLIFY = "true";
    executeMock.mockResolvedValue({ rows: [] });

    const { retryStuckRunContinuations } = await loadRetryJob();
    await retryStuckRunContinuations();

    const selectCall = executeMock.mock.calls.find(([q]) => {
      const sql = typeof q === "string" ? q : q.sql;
      return sql.includes("SELECT id, status, attempts");
    });
    expect(selectCall).toBeDefined();
    const args = (selectCall![0] as { args: number[] }).args;
    // args = [pendingCutoff, processingCutoff]; processingCutoff
    // should be roughly now - 75_000 (within reasonable test slop).
    const now = Date.now();
    const processingCutoff = args[1];
    expect(now - processingCutoff).toBeGreaterThanOrEqual(74_000);
    expect(now - processingCutoff).toBeLessThanOrEqual(76_000);
  });
});
