import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { registerErrorCaptureProvider } from "../server/capture-error.js";
import {
  StaleExecutionFenceError,
  withExecutionFence,
  withFencedExecutionWrite,
} from "./execution-fence.js";
import type { ActiveRun } from "./run-manager.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let failAbortConfirmation = false;
let failRelease = false;

function getExecutor(): DbExec {
  return {
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      if (
        failAbortConfirmation &&
        input.sql.includes("JOIN agent_execution_leases AS lease")
      ) {
        throw new Error("abort confirmation unavailable");
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: (fn) =>
      pglite.transaction((tx) =>
        fn({
          ...tx,
          execute: async (input) => {
            if (
              failRelease &&
              typeof input !== "string" &&
              input.sql.includes("AND lease_expires_at > clock_timestamp()") &&
              input.sql.includes("SET lease_expires_at = clock_timestamp(),")
            ) {
              throw new Error("release unavailable");
            }
            return tx.execute(input);
          },
        }),
      ),
  };
}

const batchHarness = vi.hoisted(() => ({
  gate: null as null | {
    runId: string;
    entered: () => void;
    wait: Promise<void>;
    sizes: number[];
  },
}));
vi.mock("./run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...actual,
    insertRunEvents: async (
      ...args: Parameters<typeof actual.insertRunEvents>
    ) => {
      const gate = batchHarness.gate;
      if (gate?.runId === args[0]) {
        gate.entered();
        await gate.wait;
        gate.sizes.push(args[1].length);
      }
      return actual.insertRunEvents(...args);
    },
  };
});

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => getExecutor(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));

const {
  abortRunAndTurnDurably,
  abortTurnByRefDurably,
  abortRunDurably,
  startRun,
} = await import("./run-manager.js");
const {
  AgentRunEventNotPersistedError,
  claimTaskExecutionLease,
  claimTurnExecutionLease,
  ensureRunTables,
  insertRun,
  isTurnAborted,
  markRunAborted,
  updateRunStatusIfRunning,
} = await import("./run-store.js");
const { buildAssistantTurnFromRunJournal } =
  await import("./run-thread-projector.js");

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureRunTables();
  await pglite.exec(
    "CREATE TABLE stop_projection_saves (run_id TEXT PRIMARY KEY, reply TEXT)",
  );
});

afterAll(async () => {
  await pglite?.close();
});

async function savedReply(runId: string): Promise<string | null | undefined> {
  const { rows } = await pglite.query(
    "SELECT reply FROM stop_projection_saves WHERE run_id = ?",
    [runId],
  );
  return (rows[0] as { reply?: string | null } | undefined)?.reply;
}

/**
 * Streams `text`, then waits for Stop. Its completion projects the reply from
 * the durable journal and saves it with a fenced write, as the chat plugin's
 * completion does with the thread.
 */
function startStoppableRun(input: {
  runId: string;
  threadId: string;
  text?: string;
  beforeStopSaved?: (run: ActiveRun) => Promise<void>;
}) {
  let streamed!: () => void;
  const ready = new Promise<void>((resolve) => {
    streamed = resolve;
  });
  const completion: { error?: unknown } = {};
  const run = startRun(
    input.runId,
    input.threadId,
    async (send, signal) => {
      if (input.text) {
        for (const word of input.text.split(" ")) {
          await send({ type: "text", text: `${word} ` });
        }
      }
      streamed();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
    async (completed) => {
      try {
        await input.beforeStopSaved?.(completed);
        const { assistant } = await buildAssistantTurnFromRunJournal({
          threadId: input.threadId,
          turnId: completed.turnId,
          runId: completed.runId,
          runEvents: completed.events,
        });
        await withFencedExecutionWrite(
          (tx) =>
            tx.execute({
              sql: "INSERT INTO stop_projection_saves (run_id, reply) VALUES (?, ?)",
              args: [
                completed.runId,
                assistant ? JSON.stringify(assistant) : null,
              ],
            }),
          { threadId: input.threadId },
        );
      } catch (error) {
        completion.error = error;
        throw error;
      }
    },
    {
      softTimeoutMs: 0,
      noProgressTimeoutMs: 0,
      executionLease: true,
    },
  );
  return { run, ready, completion };
}

describe("a stopped leased run's completion", () => {
  it("finalizes a locally stopped run without reporting a stale release", async () => {
    const runId = "run-local-abort-release";
    const { run, ready } = startStoppableRun({
      runId,
      threadId: "thread-local-abort-release",
      text: "Saved before stopping",
    });
    const captures: Array<{ phase?: string; code?: unknown }> = [];
    const unregister = registerErrorCaptureProvider(
      "local-abort-release",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          code: (error as { code?: unknown })?.code,
        });
      },
    );
    try {
      await ready;
      await abortRunAndTurnDurably(runId, "user");
      await expect(run.finalized).resolves.toBeUndefined();
      const { rows } = await pglite.query(
        `SELECT r.status, r.abort_reason, l.lease_expires_at > clock_timestamp() AS live,
                (SELECT event_data FROM agent_run_events WHERE run_id = r.id ORDER BY seq DESC LIMIT 1) AS event
         FROM agent_runs r JOIN agent_execution_leases l ON l.owner_run_id = r.id WHERE r.id = ?`,
        [runId],
      );
      expect(rows[0]).toMatchObject({
        status: "aborted",
        abort_reason: "user",
        live: false,
        event: '{"type":"done","reason":"user"}',
      });
      expect(await savedReply(runId)).toContain("Saved before stopping");
      expect(
        captures.filter(({ phase }) => phase === "execution-lease-release"),
      ).toEqual([]);
    } finally {
      unregister();
    }
  });

  it("finalizes an externally aborted run after observing its durable stop", async () => {
    const runId = "run-external-abort";
    const { run, ready } = startStoppableRun({
      runId,
      threadId: "thread-external-abort",
    });
    const captures: Array<{ phase?: string; code?: unknown }> = [];
    const unregister = registerErrorCaptureProvider(
      "external-abort",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          code: (error as { code?: unknown })?.code,
        });
      },
    );
    try {
      await ready;
      await expect(markRunAborted(runId, "user")).resolves.toBe(true);
      await expect(run.finalized).resolves.toBeUndefined();
      const { rows } = await pglite.query(
        `SELECT r.status, r.abort_reason, l.lease_expires_at > clock_timestamp() AS live,
                (SELECT event_data FROM agent_run_events WHERE run_id = r.id ORDER BY seq DESC LIMIT 1) AS event
         FROM agent_runs r JOIN agent_execution_leases l ON l.owner_run_id = r.id WHERE r.id = ?`,
        [runId],
      );
      expect(rows[0]).toMatchObject({
        status: "aborted",
        abort_reason: "user",
        live: false,
        event: '{"type":"done","reason":"user"}',
      });
      expect(await savedReply(runId)).toBeNull();
      expect(
        captures.filter(
          ({ phase }) =>
            phase === "terminal-status-persistence" ||
            phase === "execution-lease-release",
        ),
      ).toEqual([]);
    } finally {
      unregister();
    }
  });

  it("finalizes a locally stopped turn without reporting a stale release", async () => {
    const runId = "run-local-turn-abort";
    const { run, ready } = startStoppableRun({
      runId,
      threadId: "thread-local-turn-abort",
    });
    const captures: Array<{ phase?: string; code?: unknown }> = [];
    const unregister = registerErrorCaptureProvider(
      "local-turn-abort",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          code: (error as { code?: unknown })?.code,
        });
      },
    );
    try {
      await ready;
      await expect(
        abortTurnByRefDurably(run.threadId, run.turnId, "user"),
      ).resolves.toBe("aborted");
      await expect(run.finalized).resolves.toBeUndefined();
      const { rows } = await pglite.query(
        "SELECT status, terminal_reason FROM agent_runs WHERE id = ?",
        [runId],
      );
      expect(rows[0]).toMatchObject({
        status: "aborted",
        terminal_reason: "aborted:user",
      });
      expect(
        captures.filter(
          ({ phase }) =>
            phase === "terminal-status-persistence" ||
            phase === "execution-lease-release",
        ),
      ).toEqual([]);
    } finally {
      unregister();
    }
  });

  it("does not accept an abort whose terminal event is missing", async () => {
    const runId = "run-external-abort-missing-event";
    const { run, ready } = startStoppableRun({
      runId,
      threadId: "thread-external-abort-missing-event",
    });
    const captures: Array<{ phase?: string; code?: unknown }> = [];
    const unregister = registerErrorCaptureProvider(
      "external-abort-missing-event",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          code: (error as { code?: unknown })?.code,
        });
      },
    );
    try {
      await ready;
      await markRunAborted(runId, "user");
      await pglite.query("DELETE FROM agent_run_events WHERE run_id = ?", [
        runId,
      ]);
      await expect(run.finalized).rejects.toMatchObject({
        code: "stale_execution_fence",
      });
      expect(captures).toContainEqual({
        phase: "terminal-status-persistence",
        code: "stale_execution_fence",
      });
      expect(captures).toContainEqual({
        phase: "execution-lease-release",
        code: "stale_execution_fence",
      });
    } finally {
      unregister();
    }
  });

  it("reports an unreadable abort confirmation and still attempts release", async () => {
    const runId = "run-external-abort-confirmation-unavailable";
    const { run, ready } = startStoppableRun({
      runId,
      threadId: "thread-external-abort-confirmation-unavailable",
    });
    const captures: Array<{ phase?: string; code?: unknown }> = [];
    const unregister = registerErrorCaptureProvider(
      "external-abort-confirmation-unavailable",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          code: (error as { code?: unknown })?.code,
        });
      },
    );
    try {
      await ready;
      await markRunAborted(runId, "user");
      failAbortConfirmation = true;
      await expect(run.finalized).rejects.toMatchObject({
        message:
          "Could not confirm the durable abort after losing the execution fence",
        errors: [
          expect.objectContaining({ code: "stale_execution_fence" }),
          expect.objectContaining({
            message: "abort confirmation unavailable",
          }),
        ],
      });
      expect(captures.map(({ phase }) => phase)).toContain(
        "execution-lease-abort-confirmation",
      );
      expect(captures).toContainEqual({
        phase: "execution-lease-release",
        code: "stale_execution_fence",
      });
    } finally {
      failAbortConfirmation = false;
      unregister();
    }
  });

  it("does not mistake a successor lease for the stopped worker's revoked lease", async () => {
    const runId = "run-external-abort-reclaimed";
    const threadId = "thread-external-abort-reclaimed";
    const successorId = "run-external-abort-successor";
    const { run, ready } = startStoppableRun({
      runId,
      threadId,
      beforeStopSaved: async (completed) => {
        await insertRun(successorId, threadId, completed.turnId);
        await claimTurnExecutionLease(threadId, completed.turnId, successorId);
      },
    });
    const captures: Array<{ phase?: string; code?: unknown }> = [];
    const unregister = registerErrorCaptureProvider(
      "external-abort-reclaimed",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          code: (error as { code?: unknown })?.code,
        });
      },
    );
    try {
      await ready;
      await markRunAborted(runId, "user");
      await expect(run.finalized).rejects.toMatchObject({
        code: "stale_execution_fence",
      });
      const { rows } = await pglite.query(
        `SELECT owner_run_id, lease_expires_at > clock_timestamp() AS live
         FROM agent_execution_leases WHERE thread_id = ? AND turn_id = ?`,
        [threadId, run.turnId],
      );
      expect(rows[0]).toMatchObject({ owner_run_id: successorId, live: true });
      expect(captures).toContainEqual({
        phase: "terminal-status-persistence",
        code: "stale_execution_fence",
      });
      expect(captures).toContainEqual({
        phase: "execution-lease-release",
        code: "stale_execution_fence",
      });
    } finally {
      unregister();
    }
  });

  it("does not treat a stale parent fence as the stopped worker's lease", async () => {
    const parent = await claimTaskExecutionLease(
      "parent-task-thread",
      "parent-task-turn",
      "parent-task-owner",
    );
    const runId = "run-stopped-under-stale-parent";
    const { run, ready } = withExecutionFence(parent, () =>
      startStoppableRun({
        runId,
        threadId: "thread-stopped-under-stale-parent",
      }),
    );
    try {
      await ready;
      await markRunAborted(runId, "user");
      await pglite.query(
        "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE owner_run_id = ?",
        [parent.runId],
      );
      await expect(run.finalized).rejects.toMatchObject({
        code: "stale_execution_fence",
        fence: { runId: parent.runId, generation: parent.generation },
      });
    } finally {
      // The run's cleanup settles before the database closes.
    }
  });

  it("still reports an expired lease without a durable abort", async () => {
    const runId = "run-unexplained-lease-expiry";
    const threadId = "thread-unexplained-lease-expiry";
    const { run, ready } = startStoppableRun({ runId, threadId });
    const captures: Array<{ phase?: string; code?: unknown }> = [];
    const unregister = registerErrorCaptureProvider(
      "unexplained-lease-expiry",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          code: (error as { code?: unknown })?.code,
        });
      },
    );
    try {
      await ready;
      await pglite.query(
        "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE owner_run_id = ?",
        [runId],
      );
      await expect(run.finalized).resolves.toBeUndefined();
      const { rows } = await pglite.query(
        "SELECT status FROM agent_runs WHERE id = ?",
        [runId],
      );
      expect(rows[0]).toMatchObject({ status: "running" });
      expect(captures).toContainEqual({
        phase: "execution-lease-release",
        code: "stale_execution_fence",
      });
    } finally {
      unregister();
    }
  });

  it("still reports unrelated release failures for a completed run", async () => {
    const captures: Array<{ phase?: string; message?: string }> = [];
    const unregister = registerErrorCaptureProvider(
      "release-unavailable",
      (error, context) => {
        captures.push({
          phase: context.tags?.phase,
          message: (error as Error)?.message,
        });
      },
    );
    try {
      failRelease = true;
      const run = startRun(
        "run-release-unavailable",
        "thread-release-unavailable",
        async () => {},
        undefined,
        {
          executionLease: true,
          softTimeoutMs: 0,
          noProgressTimeoutMs: 0,
        },
      );
      await expect(run.finalized).resolves.toBeUndefined();
      const { rows } = await pglite.query(
        "SELECT status FROM agent_runs WHERE id = ?",
        [run.runId],
      );
      expect(rows[0]).toMatchObject({ status: "completed" });
      expect(captures).toContainEqual({
        phase: "execution-lease-release",
        message: "release unavailable",
      });
    } finally {
      failRelease = false;
      unregister();
    }
  });

  it("saves the partial reply the run streamed before Stop, marked as stopped", async () => {
    const runId = "run-user-stop-partial";
    const threadId = "thread-user-stop-partial";
    const { run, ready, completion } = startStoppableRun({
      runId,
      threadId,
      text: "14. Mangrove forests grow along tropical co",
    });
    await ready;

    await abortRunAndTurnDurably(runId, "user");
    await run.finalized;

    expect(completion.error).toBeUndefined();
    const reply = JSON.parse((await savedReply(runId)) ?? "null");
    expect(reply).toMatchObject({
      role: "assistant",
      status: { type: "complete", reason: "stop" },
      metadata: { runId, custom: { userStopped: true } },
    });
    expect(
      reply.content
        .filter((part: { type: string }) => part.type === "text")
        .map((part: { text: string }) => part.text)
        .join(""),
    ).toContain("Mangrove forests grow along tropical co");
  });

  it("saves no reply for a run stopped before it wrote anything", async () => {
    const runId = "run-user-stop-empty";
    const threadId = "thread-user-stop-empty";
    const { run, ready, completion } = startStoppableRun({ runId, threadId });
    await ready;

    await abortRunAndTurnDurably(runId, "user");
    await run.finalized;

    expect(completion.error).toBeUndefined();
    expect(await savedReply(runId)).toBeNull();
  });

  it("still refuses the save once another worker claimed the turn", async () => {
    const runId = "run-user-stop-reclaimed";
    const threadId = "thread-user-stop-reclaimed";
    const { run, ready, completion } = startStoppableRun({
      runId,
      threadId,
      text: "A reply nobody owns anymore",
      // What a successor's lease claim writes to the turn's lease row.
      beforeStopSaved: async (completed) => {
        await pglite.query(
          `UPDATE agent_execution_leases
           SET generation = generation + 1,
               owner_run_id = 'run-user-stop-successor',
               lease_expires_at = clock_timestamp() + INTERVAL '1 minute'
           WHERE thread_id = ? AND turn_id = ?`,
          [threadId, completed.turnId],
        );
      },
    });
    await ready;

    await abortRunAndTurnDurably(runId, "user");
    await run.finalized;

    expect(completion.error).toMatchObject({ code: "stale_execution_fence" });
    expect(await savedReply(runId)).toBeUndefined();
    const { rows } = await pglite.query(
      `SELECT owner_run_id, lease_expires_at > clock_timestamp() AS live
       FROM agent_execution_leases WHERE thread_id = ? AND turn_id = ?`,
      [threadId, run.turnId],
    );
    expect(rows[0]).toMatchObject({
      owner_run_id: "run-user-stop-successor",
      live: true,
    });
  });

  it("leaves a stopped run whose save failed for the projection retry", async () => {
    const runId = "run-user-stop-save-failed";
    const threadId = "thread-user-stop-save-failed";
    const { run, ready, completion } = startStoppableRun({
      runId,
      threadId,
      text: "A reply the thread could not take",
      beforeStopSaved: async () => {
        throw new Error("thread save failed");
      },
    });
    await ready;

    await abortRunAndTurnDurably(runId, "user");
    await run.finalized;

    expect(completion.error).toMatchObject({ message: "thread save failed" });
    const { rows } = await pglite.query(
      "SELECT status, thread_projection_pending FROM agent_runs WHERE id = ?",
      [runId],
    );
    expect(rows[0]).toEqual({
      status: "aborted",
      thread_projection_pending: true,
    });
  });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function events(runId: string) {
  const result = await pglite.query(
    "SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
    [runId],
  );
  return result.rows.map((row) => ({
    seq: Number(row.seq),
    ...JSON.parse(String(row.event_data)),
  }));
}
describe("durable abort with queued batch events", () => {
  it("waits for the batch before aborting and releasing its lease", async () => {
    const runId = "batch-abort-current";
    const entered = gate();
    const write = gate();
    const exited = gate();
    batchHarness.gate = {
      runId,
      entered: entered.resolve,
      wait: write.promise,
      sizes: [],
    };
    const run = startRun(
      runId,
      runId,
      async (send, signal) => {
        void send({ type: "text", text: "first" });
        void send({ type: "text", text: "second" });
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        exited.resolve();
      },
      undefined,
      { softTimeoutMs: 0, noProgressTimeoutMs: 0, executionLease: true },
    );
    try {
      await entered.promise;
      const flush = vi.spyOn(run, "flushEvents");
      const response = abortRunDurably(runId);
      await exited.promise;
      await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
      const before = await pglite.query(
        "SELECT r.status, l.lease_expires_at > clock_timestamp() AS lease_is_live FROM agent_runs r JOIN agent_execution_leases l ON l.thread_id = r.thread_id AND l.turn_id = r.turn_id WHERE r.id = ?",
        [runId],
      );
      expect(before.rows[0]).toMatchObject({
        status: "running",
        lease_is_live: true,
      });
      write.resolve();
      await expect(response).resolves.toBe(true);
      await run.finalized;
      expect(batchHarness.gate?.sizes).toEqual([2]);
      expect(await events(runId)).toEqual([
        { seq: 0, type: "text", text: "first" },
        { seq: 1, type: "text", text: "second" },
        { seq: 2, type: "done", reason: "user" },
      ]);
      const after = await pglite.query(
        "SELECT r.status, l.lease_expires_at > clock_timestamp() AS lease_is_live FROM agent_runs r JOIN agent_execution_leases l ON l.thread_id = r.thread_id AND l.turn_id = r.turn_id WHERE r.id = ?",
        [runId],
      );
      expect(after.rows[0]).toMatchObject({
        status: "aborted",
        lease_is_live: false,
      });
    } finally {
      write.resolve();
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await run.finalized.catch(() => {});
      batchHarness.gate = null;
    }
  });

  it("reports both a lost queued event and a stale abort fence", async () => {
    const runId = "batch-terminal-loss-stale-abort";
    const entered = gate();
    const write = gate();
    const driver = gate();
    batchHarness.gate = {
      runId,
      entered: entered.resolve,
      wait: write.promise,
      sizes: [],
    };
    const run = startRun(
      runId,
      runId,
      async (send) => {
        void send({ type: "text", text: "lost queued text" });
        await driver.promise;
      },
      undefined,
      { softTimeoutMs: 0, noProgressTimeoutMs: 0, executionLease: true },
    );
    const finalization = run.finalized.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await entered.promise;
      expect(await updateRunStatusIfRunning(runId, "aborted")).toBe(true);
      await vi.waitFor(() => expect(run.abort.signal.aborted).toBe(true), {
        timeout: 6_000,
      });
      write.resolve();
      const eventError = await run.flushEvents().then(
        () => null,
        (error: unknown) => error,
      );
      expect(eventError).toBeInstanceOf(AgentRunEventNotPersistedError);
      expect(eventError).toMatchObject({
        terminalRun: true,
        message: `Run event was not persisted: ${runId} sequence 0`,
      });

      await pglite.query(
        "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE thread_id = ? AND turn_id = ?",
        [runId, runId],
      );
      await insertRun(`${runId}-successor`, runId, runId);
      await claimTurnExecutionLease(runId, runId, `${runId}-successor`);
      driver.resolve();
      const error = await finalization;
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([
        eventError,
        expect.objectContaining({ code: "stale_execution_fence" }),
      ]);
      expect((error as AggregateError).errors[1]).toBeInstanceOf(
        StaleExecutionFenceError,
      );
      expect(await events(runId)).not.toContainEqual(
        expect.objectContaining({ type: "text", text: "lost queued text" }),
      );
      const state = await pglite.query(
        "SELECT r.status, l.owner_run_id FROM agent_runs r JOIN agent_execution_leases l ON l.thread_id = r.thread_id AND l.turn_id = r.turn_id WHERE r.id = ?",
        [runId],
      );
      expect(state.rows[0]).toEqual({
        status: "aborted",
        owner_run_id: `${runId}-successor`,
      });
    } finally {
      write.resolve();
      driver.resolve();
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await finalization;
      batchHarness.gate = null;
    }
  });

  it("reports a nonterminal event conflict and a later stale abort fence", async () => {
    const runId = "batch-nonterminal-loss-stale-abort";
    const entered = gate();
    const write = gate();
    const driver = gate();
    batchHarness.gate = {
      runId,
      entered: entered.resolve,
      wait: write.promise,
      sizes: [],
    };
    const run = startRun(
      runId,
      runId,
      async (send) => {
        void send({ type: "text", text: "lost queued text" });
        await driver.promise;
      },
      undefined,
      { softTimeoutMs: 0, noProgressTimeoutMs: 0, executionLease: true },
    );
    const finalization = run.finalized.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await entered.promise;
      await pglite.query(
        "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, 0, 0, ?)",
        [runId, JSON.stringify({ type: "text", text: "existing event" })],
      );
      write.resolve();
      const eventError = await run.flushEvents().then(
        () => null,
        (error: unknown) => error,
      );
      expect(eventError).toBeInstanceOf(AgentRunEventNotPersistedError);
      expect(eventError).toMatchObject({
        terminalRun: false,
        message: `Run event was not persisted: ${runId} sequence 0`,
      });
      const before = await pglite.query(
        "SELECT status FROM agent_runs WHERE id = ?",
        [runId],
      );
      expect(before.rows[0]).toEqual({ status: "running" });

      run.abort.abort("user");
      await pglite.query(
        "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE thread_id = ? AND turn_id = ?",
        [runId, runId],
      );
      await insertRun(`${runId}-successor`, runId, runId);
      await claimTurnExecutionLease(runId, runId, `${runId}-successor`);
      driver.resolve();
      const error = await finalization;
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([
        eventError,
        expect.objectContaining({ code: "stale_execution_fence" }),
      ]);
      expect((error as AggregateError).errors[0]).toBe(eventError);
      expect((error as AggregateError).errors[1]).toBeInstanceOf(
        StaleExecutionFenceError,
      );
      expect(await events(runId)).toEqual([
        { seq: 0, type: "text", text: "existing event" },
      ]);
      expect(await isTurnAborted(runId, runId)).toBe(false);
      const state = await pglite.query(
        "SELECT r.status, l.owner_run_id FROM agent_runs r JOIN agent_execution_leases l ON l.thread_id = r.thread_id AND l.turn_id = r.turn_id WHERE r.id = ?",
        [runId],
      );
      expect(state.rows[0]).toEqual({
        status: "running",
        owner_run_id: `${runId}-successor`,
      });
    } finally {
      write.resolve();
      driver.resolve();
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await finalization;
      batchHarness.gate = null;
    }
  });

  it("rejects a reclaimed worker's batch without writing events or abort intent", async () => {
    const runId = "batch-abort-stale";
    const entered = gate();
    const write = gate();
    const driver = gate();
    batchHarness.gate = {
      runId,
      entered: entered.resolve,
      wait: write.promise,
      sizes: [],
    };
    const run = startRun(
      runId,
      runId,
      async (send) => {
        void send({ type: "text", text: "stale" }).catch(() => {});
        await driver.promise;
      },
      undefined,
      { softTimeoutMs: 0, noProgressTimeoutMs: 0, executionLease: true },
    );
    const finalization = run.finalized.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await entered.promise;
      await pglite.query(
        "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE thread_id = ? AND turn_id = ?",
        [runId, runId],
      );
      await insertRun(`${runId}-successor`, runId, runId);
      await claimTurnExecutionLease(runId, runId, `${runId}-successor`);
      const flush = vi.spyOn(run, "flushEvents");
      const response = abortRunDurably(runId);
      await vi.waitFor(() => expect(flush).toHaveBeenCalled());
      write.resolve();
      const eventError = await response.then(
        () => null,
        (error: unknown) => error,
      );
      expect(eventError).toBeInstanceOf(StaleExecutionFenceError);
      driver.resolve();
      const error = await finalization;
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([
        eventError,
        expect.objectContaining({ code: "stale_execution_fence" }),
      ]);
      expect((error as AggregateError).errors[0]).toBe(eventError);
      expect((error as AggregateError).errors[1]).toBeInstanceOf(
        StaleExecutionFenceError,
      );
      expect((error as AggregateError).errors[1]).not.toBe(eventError);
      expect(await events(runId)).toEqual([]);
      expect(await isTurnAborted(runId, runId)).toBe(false);
      const state = await pglite.query(
        "SELECT status FROM agent_runs WHERE id = ?",
        [runId],
      );
      expect(state.rows[0]).toMatchObject({ status: "running" });
    } finally {
      write.resolve();
      driver.resolve();
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await finalization;
      batchHarness.gate = null;
    }
  });
});
