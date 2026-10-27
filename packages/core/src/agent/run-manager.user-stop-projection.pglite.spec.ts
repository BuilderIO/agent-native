import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { withFencedExecutionWrite } from "./execution-fence.js";
import type { ActiveRun } from "./run-manager.js";

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

const { abortRunAndTurnDurably, startRun } = await import("./run-manager.js");
const { ensureRunTables } = await import("./run-store.js");
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
