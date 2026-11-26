import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRunAbortState } from "./run-store.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  captureError: vi.fn(),
  cutoffReadFailure: null as Error | null,
}));

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/capture-error.js", () => ({
  captureError: mocks.captureError,
}));

beforeEach(() => {
  mocks.captureError.mockReset();
  mocks.cutoffReadFailure = null;
  mocks.execute.mockReset();
  mocks.execute.mockImplementation(async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (sql.includes("SELECT status, abort_reason FROM agent_runs")) {
      return {
        rows: [{ status: "aborted", abort_reason: "user" }],
        rowsAffected: 0,
      };
    }
    if (sql.includes("SELECT event_data FROM agent_run_events")) {
      if (mocks.cutoffReadFailure) throw mocks.cutoffReadFailure;
      return {
        rows: [
          {
            event_data: JSON.stringify({
              type: "done",
              reason: "user",
              shownThroughSeq: 4,
            }),
          },
        ],
        rowsAffected: 0,
      };
    }
    return { rows: [], rowsAffected: 0 };
  });
});

describe("a stopped run's abort state", () => {
  it("carries where the Stop's browser was", async () => {
    await expect(getRunAbortState("run-stopped")).resolves.toEqual({
      aborted: true,
      reason: "user",
      shownThroughSeq: 4,
    });
  });

  it("still reports the Stop, and reports the failed read, when the cutoff can't be read", async () => {
    const failure = new Error("connection reset");
    mocks.cutoffReadFailure = failure;

    await expect(getRunAbortState("run-stopped")).resolves.toEqual({
      aborted: true,
      reason: "user",
    });
    expect(mocks.captureError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({ operation: "read-user-stop-cutoff" }),
        extra: { runId: "run-stopped" },
      }),
    );
  });
});
