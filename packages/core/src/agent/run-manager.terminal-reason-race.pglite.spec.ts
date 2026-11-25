import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { registerErrorCaptureProvider } from "../server/capture-error.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
const terminalCommit = vi.hoisted(() => ({
  runId: "",
  entered: () => {},
  wait: Promise.resolve(),
}));

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: (): DbExec => ({
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: async (fn) => {
      const committed = { terminal: false };
      const result = await pglite.transaction((tx) =>
        fn({
          ...tx,
          async execute(input) {
            const result = await tx.execute(input);
            if (
              typeof input !== "string" &&
              /UPDATE\s+agent_runs\b[\s\S]*?\bstatus\s*=/i.test(input.sql) &&
              input.args.includes(terminalCommit.runId) &&
              input.args.includes("completed") &&
              result.rowsAffected
            ) {
              committed.terminal = true;
            }
            return result;
          },
        }),
      );
      if (committed.terminal) {
        terminalCommit.entered();
        await terminalCommit.wait;
      }
      return result;
    },
  }),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

const { startRun } = await import("./run-manager.js");
const { ensureRunTables, insertRun, claimTurnExecutionLease } =
  await import("./run-store.js");

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
});

afterAll(async () => {
  await pglite.close();
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("terminal persistence across a successor lease claim", () => {
  it("retains the completed reason without reporting a persistence failure", async () => {
    const runId = "terminal-reason-first";
    const threadId = "terminal-reason-thread";
    const turnId = "terminal-reason-turn";
    const successorId = "terminal-reason-successor";
    const committed = gate();
    const resume = gate();
    terminalCommit.runId = runId;
    terminalCommit.entered = committed.resolve;
    terminalCommit.wait = resume.promise;
    const provider = vi.fn();
    const unregister = registerErrorCaptureProvider(
      "terminal-reason-race",
      provider,
    );
    const run = startRun(
      runId,
      threadId,
      async (send) => {
        await send({ type: "text", text: "Answer" });
      },
      undefined,
      {
        executionLease: true,
        softTimeoutMs: 0,
        noProgressTimeoutMs: 0,
        turnId,
      },
    );

    try {
      await committed.promise;
      const before = await pglite.query(
        `SELECT r.status, r.terminal_reason, l.generation, l.lease_expires_at > clock_timestamp() AS lease_is_live
           FROM agent_runs r JOIN agent_execution_leases l ON l.owner_run_id = r.id
          WHERE r.id = ?`,
        [runId],
      );
      expect(before.rows[0]).toMatchObject({
        status: "completed",
        terminal_reason: "done",
        lease_is_live: true,
      });
      const generation = BigInt(String(before.rows[0]?.generation));
      const events = await pglite.query(
        "SELECT event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
        [runId],
      );
      expect(
        events.rows.map((row) => JSON.parse(String(row.event_data))),
      ).toEqual([
        { type: "text", text: "Answer" },
        expect.objectContaining({ type: "done" }),
      ]);

      await insertRun(successorId, threadId, turnId);
      const successor = await claimTurnExecutionLease(
        threadId,
        turnId,
        successorId,
      );
      expect(BigInt(successor.generation)).toBe(generation + 1n);
      resume.resolve();
      await run.finalized;

      const after = await pglite.query(
        "SELECT status, terminal_reason FROM agent_runs WHERE id = ?",
        [runId],
      );
      expect
        .soft(after.rows)
        .toEqual([{ status: "completed", terminal_reason: "done" }]);
      expect
        .soft(
          provider.mock.calls.filter(
            ([, context]) =>
              context?.tags?.phase === "terminal-status-persistence",
          ),
        )
        .toEqual([]);
    } finally {
      resume.resolve();
      await run.finalized.catch(() => {});
      unregister();
      terminalCommit.runId = "";
    }
  });
});
