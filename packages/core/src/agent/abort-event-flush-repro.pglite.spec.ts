import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
function getExecutor(): DbExec {
  return {
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
    transaction: (fn) => pglite.transaction((tx) => fn(tx)),
  };
}
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => getExecutor(),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));
const { startRun, abortRunAndTurnDurably } = await import("./run-manager.js");
const {
  ensureRunTables,
  markRunAborted,
  insertRun,
  claimTurnExecutionLease,
  isTurnAborted,
} = await import("./run-store.js");

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
});
afterAll(async () => {
  await pglite?.close();
});

describe("abort with a queued, fenced event", () => {
  for (const mode of ["current", "expired", "reclaimed", "terminal"] as const) {
    it(mode, async () => {
      const runId = `flush-repro-${mode}`;
      const threadId = `flush-repro-thread-${mode}`;
      const entered = gate();
      const eventGate = gate();
      const driverGate = gate();
      const run = startRun(
        runId,
        threadId,
        async (send) => {
          void send({ type: "text", text: `queued-${mode}` }).catch(() => {});
          await driverGate.promise;
        },
        undefined,
        {
          softTimeoutMs: 0,
          noProgressTimeoutMs: 0,
          executionLease: true,
          persistEvent: async (write) => {
            entered.resolve();
            await eventGate.promise;
            await write();
          },
        },
      );
      await entered.promise;
      if (mode === "expired" || mode === "reclaimed") {
        await pglite.query(
          "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE thread_id = ? AND turn_id = ?",
          [threadId, runId],
        );
      }
      if (mode === "reclaimed") {
        const successorId = `${runId}-successor`;
        await insertRun(successorId, threadId, runId);
        await claimTurnExecutionLease(threadId, runId, successorId);
      }
      if (mode === "terminal") await markRunAborted(runId, "other-worker");
      const stop = abortRunAndTurnDurably(runId, "user").then(
        () => ({ ok: true, name: null, message: null, terminalRun: null }),
        (error: unknown) => ({
          ok: false,
          name: error instanceof Error ? error.name : String(error),
          message: error instanceof Error ? error.message : String(error),
          terminalRun:
            error && typeof error === "object" && "terminalRun" in error
              ? error.terminalRun
              : null,
        }),
      );
      eventGate.resolve();
      const result = await stop;
      const state = await pglite.query(
        "SELECT id, status, dispatch_mode, terminal_reason FROM agent_runs WHERE thread_id = ? ORDER BY id",
        [threadId],
      );
      const events = await pglite.query(
        "SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
        [runId],
      );
      const turnAborted = await isTurnAborted(threadId, runId);
      const textPersisted = events.rows.some((event) =>
        String(event.event_data).includes(`queued-${mode}`),
      );
      const statuses = state.rows.map((row) => ({
        id: row.id,
        status: row.status,
        dispatch_mode: row.dispatch_mode,
      }));
      console.log(
        "REPRO",
        mode,
        JSON.stringify({
          result,
          statuses,
          eventCount: events.rows.length,
          textPersisted,
          turnAborted,
        }),
      );
      if (mode === "current") {
        expect(result.ok).toBe(true);
        expect(textPersisted).toBe(true);
        expect(statuses[0]).toMatchObject({ status: "aborted" });
      } else if (mode === "expired" || mode === "reclaimed") {
        expect(result).toMatchObject({
          ok: false,
          name: "StaleExecutionFenceError",
        });
        expect(statuses[0]).toMatchObject({ status: "running" });
        expect(textPersisted).toBe(false);
        expect(turnAborted).toBe(false);
      } else {
        expect(result).toMatchObject({
          ok: false,
          name: "AgentRunEventNotPersistedError",
          terminalRun: true,
        });
        expect(statuses[0]).toMatchObject({ status: "aborted" });
        expect(textPersisted).toBe(false);
      }
      driverGate.resolve();
      await run.finalized.catch(() => {});
      const finalState = await pglite.query(
        "SELECT id, status FROM agent_runs WHERE thread_id = ? ORDER BY id",
        [threadId],
      );
      const finalTurnAborted = await isTurnAborted(threadId, runId);
      console.log("REPRO FINAL", mode, JSON.stringify(finalState.rows));
      console.log("REPRO TURN MARKER", mode, finalTurnAborted);
      if (mode === "expired" || mode === "reclaimed") {
        expect(finalState.rows[0]).toMatchObject({ status: "running" });
        expect(finalTurnAborted).toBe(false);
      }
    });
  }
});
