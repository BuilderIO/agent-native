import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const foldReapedRunIntoThreadMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("./reaped-run-thread.js", () => ({
  foldReapedRunIntoThread: foldReapedRunIntoThreadMock,
}));

const pglite = await createTestPglite();
let afterStaleCandidateScan: (() => Promise<void>) | undefined;

afterAll(async () => {
  await pglite.close();
});

afterEach(async () => {
  await pglite.exec(
    "DELETE FROM agent_run_events; DELETE FROM agent_execution_leases; DELETE FROM agent_runs;",
  );
});

function makeRawClient(withTransaction: boolean) {
  const client: {
    execute: ReturnType<typeof vi.fn>;
    transaction?: <T>(fn: (tx: typeof client) => Promise<T>) => Promise<T>;
  } = {
    execute: vi.fn(
      async (input: string | { sql: string; args?: unknown[] }) => {
        if (typeof input === "string") {
          await pglite.exec(input);
          return { rows: [] as unknown[], rowsAffected: 0 };
        }
        const stmt = await pglite.prepare(input.sql);
        const args = (input.args ?? []) as unknown[];
        if (/^\s*select/i.test(input.sql)) {
          const rows = await stmt.all(...args);
          if (
            /SELECT id FROM agent_runs[\s\S]*ORDER BY started_at ASC[\s\S]*LIMIT/i.test(
              input.sql,
            )
          ) {
            const afterScan = afterStaleCandidateScan;
            afterStaleCandidateScan = undefined;
            await afterScan?.();
          }
          return { rows, rowsAffected: 0 };
        }
        if (/\bRETURNING\b/i.test(input.sql)) {
          const rows = await stmt.all(...args);
          return { rows, rowsAffected: rows.length };
        }
        const info = await stmt.run(...args);
        return { rows: [] as unknown[], rowsAffected: info.changes };
      },
    ),
  };
  if (withTransaction) {
    client.transaction = async <T>(
      fn: (tx: typeof client) => Promise<T>,
    ): Promise<T> => {
      await client.execute("BEGIN");
      try {
        const result = await fn(client);
        await client.execute("COMMIT");
        return result;
      } catch (err) {
        await client.execute("ROLLBACK").catch(() => {});
        throw err;
      }
    };
  }
  return client;
}

let currentClient = makeRawClient(true);

vi.mock("../db/client.js", () => ({
  getDbExec: () => currentClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const fireInternalDispatchMock = vi.fn(async () => {});
vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: (...args: unknown[]) =>
    fireInternalDispatchMock(...args),
}));

const {
  insertRun,
  tryClaimRunSlot,
  claimTurnExecutionLease,
  claimBackgroundRun,
  getRunByThread,
  getCurrentTurnEventsForThread,
  isTurnAborted,
  markTurnAborted,
  reapIfStale,
  reapAllStaleRuns,
  cleanupOldRuns,
  failRunBeforeDispatch,
  recordRunDiagnostic,
  RUN_DIAG_STAGE,
  BACKGROUND_RUN_STALE_MS,
  BACKGROUND_PROCESSING_RUN_STALE_MS,
  STALE_RUN_TERMINAL_REASON,
  __resetNoRunningRunsProbeForTests,
} = await import("./run-store.js");
const { assertNoInlineImageBytes } = await import("../shared/inline-bytes.js");

beforeEach(async () => {
  __resetNoRunningRunsProbeForTests();
  afterStaleCandidateScan = undefined;
  foldReapedRunIntoThreadMock.mockReset().mockResolvedValue(undefined);
});

let seq = 0;
function ids(): { runId: string; thread: string; turn: string } {
  seq += 1;
  return {
    runId: `run-recover-${seq}`,
    thread: `thread-recover-${seq}`,
    turn: `turn-recover-${seq}`,
  };
}

describe("recovery ledger integrity", () => {
  it.each([
    "{broken",
    "null",
    "[]",
    "{}",
    '{"type":"tool_start","input":{}}',
    '{"type":"tool_start","tool":"send-email"}',
    '{"type":"tool_done","tool":"send-email"}',
    '{"type":"tool_start ","tool":"send-email","input":{}}',
    '{"type":"tool_done","tool":"send-email","result":"failed","isError":"true"}',
    '{"type":"tool_done","tool":"send-email","result":"failed","completedSideEffect":"false"}',
    '{"type":"tool_done","tool":"send-email","result":"failed","replayed":null}',
  ])(
    "rejects a malformed event instead of returning partial history: %s",
    async (raw) => {
      const { runId, thread, turn } = ids();
      await insertRun(runId, thread, turn);
      const insert = await pglite.prepare(
        "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
      );
      await insert.run(
        runId,
        0,
        Date.now(),
        JSON.stringify({ type: "text", text: "Checking" }),
      );
      await insert.run(runId, 1, Date.now(), raw);
      await expect(
        getCurrentTurnEventsForThread(thread, turn),
      ).rejects.toThrow();
    },
  );
  it.each(['{"body":', [], null, false, 42])(
    "reads a recorded model input followed by its non-execution result: %j",
    async (input) => {
      const { runId, thread, turn } = ids();
      await insertRun(runId, thread, turn);
      const events = [
        {
          type: "tool_start",
          tool: "send-email",
          id: "truncated",
          input,
        },
        {
          type: "tool_done",
          tool: "send-email",
          id: "truncated",
          result: "Invalid action parameters for send-email",
          isError: true,
          completedSideEffect: false,
        },
      ];
      const insert = await pglite.prepare(
        "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)",
      );
      for (const [index, event] of events.entries())
        await insert.run(runId, index, Date.now(), JSON.stringify(event));
      expect(await getCurrentTurnEventsForThread(thread, turn)).toEqual(events);
    },
  );
});

async function setStaleLiveness(runId: string, atMs: number): Promise<void> {
  await pglite
    .prepare(
      `UPDATE agent_runs SET heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    )
    .run(atMs, atMs, runId);
}

async function setDeadOnArrival(
  runId: string,
  startedAtMs: number,
): Promise<void> {
  await pglite
    .prepare(
      `UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    )
    .run(startedAtMs, startedAtMs + 5_000, startedAtMs + 5_000, runId);
}

async function readRow(runId: string): Promise<
  | {
      id: string;
      status: string;
      turn_id: string | null;
      dispatch_mode: string | null;
      dispatch_payload: string | null;
      terminal_reason: string | null;
      diag_stage: string | null;
      error_code: string | null;
    }
  | undefined
> {
  const rows = await pglite
    .prepare(
      `SELECT id, status, turn_id, dispatch_mode, dispatch_payload, terminal_reason, diag_stage, error_code FROM agent_runs WHERE id = ?`,
    )
    .all(runId);
  return rows[0] as any;
}

async function rowsForTurn(
  turnId: string,
): Promise<Array<{ id: string; status: string }>> {
  return (await pglite
    .prepare(`SELECT id, status FROM agent_runs WHERE turn_id = ?`)
    .all(turnId)) as any;
}

async function seedPriorRun(
  runId: string,
  thread: string,
  turn: string,
  opts: { errorCode: string; startedAtMs: number },
): Promise<void> {
  await insertRun(runId, thread, turn, { dispatchMode: "background" });
  await pglite
    .prepare(
      `UPDATE agent_runs SET status = 'errored', error_code = ?, started_at = ? WHERE id = ?`,
    )
    .run(opts.errorCode, opts.startedAtMs, runId);
}

const STALE_PAST_MS = 5 * 60_000;

describe("FIX 3 — stale-run reaper server-owned recovery (reapIfStale)", () => {
  it("reaps a stale 12-minute in-flight tool after its execution lease expires", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await claimTurnExecutionLease(thread, turn, runId);

    const now = Date.now();
    const toolStartedAt = now - 12 * 60_000;
    await pglite
      .prepare(
        `UPDATE agent_runs
            SET started_at = ?, heartbeat_at = ?, last_progress_at = ?,
                in_flight_since = ?
          WHERE id = ?`,
      )
      .run(
        toolStartedAt,
        now - (BACKGROUND_RUN_STALE_MS + 10_000),
        toolStartedAt,
        toolStartedAt,
        runId,
      );
    await pglite
      .prepare(
        `UPDATE agent_execution_leases
            SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
          WHERE thread_id = ? AND turn_id = ? AND owner_run_id = ?`,
      )
      .run(thread, turn, runId);

    expect(await reapIfStale(runId)).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
  });

  it("retries a stale-run thread projection after its terminal event commits", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);
    foldReapedRunIntoThreadMock.mockRejectedValueOnce(
      new Error("thread write failed"),
    );

    await expect(reapIfStale(runId)).resolves.toBe(true);

    const [reaped] = (await pglite
      .prepare(
        `SELECT status, thread_projection_pending
         FROM agent_runs WHERE id = ?`,
      )
      .all(runId)) as Array<{
      status: string;
      thread_projection_pending: boolean;
    }>;
    const terminalEvents = await pglite
      .prepare(
        `SELECT event_data FROM agent_run_events
         WHERE run_id = ? ORDER BY seq`,
      )
      .all(runId);
    expect(reaped).toEqual({
      status: "errored",
      thread_projection_pending: true,
    });
    expect(terminalEvents).toHaveLength(1);
    expect(String(terminalEvents[0]?.event_data)).toContain(
      '"errorCode":"stale_run"',
    );

    await expect(reapAllStaleRuns()).resolves.toEqual({
      reaped: 0,
      failed: 0,
      truncated: false,
    });
    const [projected] = (await pglite
      .prepare(
        `SELECT thread_projection_pending
         FROM agent_runs WHERE id = ?`,
      )
      .all(runId)) as Array<{ thread_projection_pending: boolean }>;
    expect(foldReapedRunIntoThreadMock).toHaveBeenCalledTimes(2);
    expect(projected?.thread_projection_pending).toBe(false);
  });

  it("does not fail a missing-payload dispatch while a worker owns the live lease", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn);
    const fence = await claimTurnExecutionLease(thread, turn, runId);

    await expect(
      failRunBeforeDispatch(
        runId,
        "dispatch_payload_missing",
        "Background dispatch payload is missing or unreadable.",
        "dispatch_payload_missing",
      ),
    ).resolves.toBe(false);

    expect((await readRow(runId))?.status).toBe("running");
    expect(fence.runId).toBe(runId);
  });

  it("records a missing-payload failure atomically when no worker owns the lease", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn);

    await expect(
      failRunBeforeDispatch(
        runId,
        "dispatch_payload_missing",
        "Background dispatch payload is missing or unreadable.",
        "dispatch_payload_missing",
      ),
    ).resolves.toBe(true);

    expect(await readRow(runId)).toMatchObject({
      status: "errored",
      error_code: "dispatch_payload_missing",
      terminal_reason: "dispatch_payload_missing",
    });
  });

  it("records an early Stop as a turn marker before any real run exists", async () => {
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();

    await markTurnAborted(thread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect(await isTurnAborted(thread, `${turn}-other`)).toBe(false);
    const [marker] = (await pglite
      .prepare(`SELECT status, dispatch_mode FROM agent_runs WHERE id = ?`)
      .all(
        `turn-abort:${encodeURIComponent(thread)}:${encodeURIComponent(turn)}`,
      )) as { status: string; dispatch_mode: string } | undefined;
    expect(marker).toEqual({ status: "aborted", dispatch_mode: "turn-abort" });
    const [legacyMarker] = (await pglite
      .prepare(`SELECT status, dispatch_mode FROM agent_runs WHERE id = ?`)
      .all(`turn-abort-${turn}`)) as
      | { status: string; dispatch_mode: string }
      | undefined;
    expect(legacyMarker).toEqual({
      status: "aborted",
      dispatch_mode: "turn-abort",
    });
  });

  it("keeps early Stop markers distinct when two threads reuse one turn id", async () => {
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();
    const otherThread = `${thread}-other`;

    await markTurnAborted(thread, turn);
    await markTurnAborted(otherThread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect(await isTurnAborted(otherThread, turn)).toBe(true);
    const markers = (await pglite
      .prepare(
        `SELECT id, thread_id FROM agent_runs WHERE turn_id = ? AND dispatch_mode = 'turn-abort' ORDER BY thread_id`,
      )
      .all(turn)) as Array<{ id: string; thread_id: string }>;
    expect(markers).toHaveLength(3);
    expect(new Set(markers.map((marker) => marker.id)).size).toBe(3);
  });

  it("also aborts a run inserted after the caller's first cancellation check", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });

    await markTurnAborted(thread, turn);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect((await readRow(runId))?.status).toBe("aborted");
  });

  it("preserves a completed turn when cancellation arrives too late", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await pglite
      .prepare(
        `UPDATE agent_runs SET status = 'completed', completed_at = ? WHERE id = ?`,
      )
      .run(Date.now(), runId);
    expect(await markTurnAborted(thread, turn)).toBe("already_terminal");

    expect(
      await getRunByThread(thread, { includeTerminal: true, turnId: turn }),
    ).toMatchObject({ id: runId, status: "completed" });
  });

  it("prevents a run claim after cancellation wins the thread lock", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    expect(await markTurnAborted(thread, turn)).toBe("aborted");

    await expect(
      tryClaimRunSlot(thread, runId, undefined, { turnId: turn }),
    ).resolves.toMatchObject({
      claimed: false,
      activeRunId: null,
      turnAborted: true,
    });
    expect(await readRow(runId)).toBeUndefined();
  });

  it("keeps an abort marker across a terminal continuation boundary", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await pglite
      .prepare(
        `UPDATE agent_runs SET status = 'truncated', terminal_reason = 'loop_limit', completed_at = ? WHERE id = ?`,
      )
      .run(Date.now(), runId);
    await pglite
      .prepare(
        `INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)`,
      )
      .run(runId, 1, Date.now(), JSON.stringify({ type: "loop_limit" }));

    expect(await markTurnAborted(thread, turn)).toBe("aborted");
    await expect(
      tryClaimRunSlot(thread, `${runId}-successor`, undefined, {
        turnId: turn,
      }),
    ).resolves.toMatchObject({ turnAborted: true, claimed: false });
  });

  it("escalates Stop on one chunk to every run of the same turn", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    const successor = `${runId}-chunk2`;
    await insertRun(successor, thread, turn, { dispatchMode: "background" });

    const { abortTurnDurably } = await import("./run-manager.js");
    await abortTurnDurably(runId);

    expect(await isTurnAborted(thread, turn)).toBe(true);
    expect((await readRow(successor))?.status).toBe("aborted");
  });

  it("creates exactly one unclaimed recovery successor for a dead claimed background worker, and does not stack a second on a re-reap", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    const payload = JSON.stringify({ message: "original ingress", foo: "bar" });
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: payload,
    });
    expect(await claimBackgroundRun(runId)).toBe(true);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);

    const oldRow = await readRow(runId);
    expect(oldRow?.status).toBe("errored");
    expect(oldRow?.terminal_reason).toBe(STALE_RUN_TERMINAL_REASON);
    // Terminal writes elsewhere NULL dispatch_payload, but reapIfStale's own
    // UPDATE never touches it directly — the important invariant is that the
    // payload was captured into the successor before the row went terminal.
    expect(oldRow?.diag_stage).toContain("stale_run_recovery_attempted");
    expect(oldRow?.diag_stage).toContain("recovered");

    const siblings = await rowsForTurn(turn);
    expect(siblings).toHaveLength(2);
    const successorRow = siblings.find((r) => r.id !== runId);
    expect(successorRow).toBeDefined();
    expect(successorRow?.status).toBe("running");
    const successorFull = await readRow(successorRow!.id);
    expect(successorFull?.dispatch_mode).toBe("background");
    expect(JSON.parse(successorFull?.dispatch_payload ?? "null")).toEqual({
      message: "original ingress",
      foo: "bar",
      internalContinuation: true,
      __agentChatRecoveryOfRunId: runId,
    });

    const reapedAgain = await reapIfStale(runId);
    expect(reapedAgain).toBe(false);
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });

  it("does not let another thread's reused turn id suppress stale recovery", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await pglite
      .prepare(
        "UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?",
      )
      .run(
        Date.now() - STALE_PAST_MS,
        Date.now() - STALE_PAST_MS,
        Date.now() - STALE_PAST_MS,
        runId,
      );

    const otherThreadRun = `${runId}-other-thread`;
    await insertRun(otherThreadRun, `${thread}-other`, turn);
    await pglite
      .prepare("UPDATE agent_runs SET started_at = ? WHERE id = ?")
      .run(Date.now() + 1_000, otherThreadRun);

    expect(await reapIfStale(runId)).toBe(true);
    const successors = await pglite
      .prepare("SELECT id FROM agent_runs WHERE thread_id = ? AND id <> ?")
      .all(thread, runId);
    expect(successors).toHaveLength(1);
  });

  it("does not copy a legacy payload's inline image bytes into the successor", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    // Seed a pre-guard row without using the current persistence boundary.
    await pglite
      .prepare("UPDATE agent_runs SET dispatch_payload = ? WHERE id = ?")
      .run(
        JSON.stringify({
          message: "look",
          attachments: [
            {
              type: "image",
              name: "shot.png",
              data: "data:image/png;base64,LEGACY_SENTINEL_NOT_IMAGE_BYTES",
            },
          ],
        }),
        runId,
      );
    expect(await claimBackgroundRun(runId)).toBe(true);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    expect(await reapIfStale(runId)).toBe(true);

    const successor = (await rowsForTurn(turn)).find((r) => r.id !== runId);
    const payload = (await readRow(successor!.id))?.dispatch_payload;
    assertNoInlineImageBytes(payload, "dispatch_payload");
    expect(JSON.parse(payload!).attachments[0]).toMatchObject({
      name: "shot.png",
      omitted: "inline-bytes",
    });
  });

  it("stops recovering after 3 consecutive stale_run reaps that made near-zero progress (deterministic dead-on-arrival loop)", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    const payload = JSON.stringify({ message: "doomed request" });
    const longAgo = Date.now() - STALE_PAST_MS;

    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: payload,
    });
    await claimBackgroundRun(runId);
    await setDeadOnArrival(runId, longAgo);
    expect(await reapIfStale(runId)).toBe(true);

    let siblings = await rowsForTurn(turn);
    expect(siblings).toHaveLength(2);
    let successorId = siblings.find((r) => r.id !== runId)!.id;

    await claimBackgroundRun(successorId);
    await setDeadOnArrival(successorId, longAgo);
    expect(await reapIfStale(successorId)).toBe(true);

    siblings = await rowsForTurn(turn);
    expect(siblings).toHaveLength(3);
    const thirdRunId = siblings.find(
      (r) => r.id !== runId && r.id !== successorId,
    )!.id;

    await claimBackgroundRun(thirdRunId);
    await setDeadOnArrival(thirdRunId, longAgo);
    expect(await reapIfStale(thirdRunId)).toBe(true);

    expect((await readRow(thirdRunId))?.diag_stage).toContain("declined");
    expect((await readRow(thirdRunId))?.diag_stage).toContain(
      "repeated_no_progress",
    );
    expect(await rowsForTurn(turn)).toHaveLength(3);
  });

  it("stops recovering once 3 stale_run rows exist for a turn even when a non-stale run is interleaved (total cap, order-independent)", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    const longAgo = Date.now() - STALE_PAST_MS;

    await seedPriorRun(`${runId}-p1`, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo,
    });
    await seedPriorRun(`${runId}-p2`, thread, turn, {
      errorCode: "http_429",
      startedAtMs: longAgo + 1_000,
    });
    await seedPriorRun(`${runId}-p3`, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo + 2_000,
    });
    await seedPriorRun(`${runId}-p4`, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo + 3_000,
    });

    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, longAgo + 4_000);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.diag_stage).toContain("declined");
    expect((await readRow(runId))?.diag_stage).toContain(
      "repeated_no_progress",
    );
    expect(await rowsForTurn(turn)).toHaveLength(5);
  });

  it("two prior stale rows plus the current one still allows a successor; three prior stale rows decline", async () => {
    currentClient = makeRawClient(true);

    {
      const { runId, thread, turn } = ids();
      const longAgo = Date.now() - STALE_PAST_MS;
      await seedPriorRun(`${runId}-p1`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo,
      });
      await seedPriorRun(`${runId}-p2`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo + 1_000,
      });
      await insertRun(runId, thread, turn, {
        dispatchMode: "background",
        dispatchPayload: JSON.stringify({ ok: true }),
      });
      await claimBackgroundRun(runId);
      await setStaleLiveness(runId, longAgo + 2_000);

      expect(await reapIfStale(runId)).toBe(true);
      expect((await readRow(runId))?.diag_stage).toContain("recovered");
      expect(await rowsForTurn(turn)).toHaveLength(4);
    }

    {
      const { runId, thread, turn } = ids();
      const longAgo = Date.now() - STALE_PAST_MS;
      await seedPriorRun(`${runId}-p1`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo,
      });
      await seedPriorRun(`${runId}-p2`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo + 1_000,
      });
      await seedPriorRun(`${runId}-p3`, thread, turn, {
        errorCode: "stale_run",
        startedAtMs: longAgo + 2_000,
      });
      await insertRun(runId, thread, turn, {
        dispatchMode: "background",
        dispatchPayload: JSON.stringify({ ok: true }),
      });
      await claimBackgroundRun(runId);
      await setStaleLiveness(runId, longAgo + 3_000);

      const reaped = await reapIfStale(runId);
      expect(reaped).toBe(true);
      expect((await readRow(runId))?.diag_stage).toContain(
        "repeated_no_progress",
      );
      expect(await rowsForTurn(turn)).toHaveLength(4);
    }
  });

  it("preserves the dying worker's own last-recorded stage in the recovery diagnostic before it gets overwritten", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await recordRunDiagnostic(runId, RUN_DIAG_STAGE.workerClaimLost);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    const diag = (await readRow(runId))?.diag_stage ?? "";
    expect(diag).toContain("recovered");
    expect(diag).toContain("priorDiag=worker_claim_lost");
  });

  it("does NOT create a successor once the per-turn run budget is exhausted", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    for (let i = 0; i < 25; i++) {
      await insertRun(`${runId}-prior-${i}`, thread, turn, {
        dispatchMode: "background",
      });
    }
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("declined");
    expect((await readRow(runId))?.diag_stage).toContain("budget_exhausted");

    expect(await rowsForTurn(turn)).toHaveLength(26);
  });

  it("does NOT create a successor when the dying run has no dispatch_payload to carry over", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, { dispatchMode: "background" });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("not_redispatchable");
    expect(await rowsForTurn(turn)).toHaveLength(1);
  });

  it("gives a claimed run with no redispatch path the wider background stale window", async () => {
    currentClient = makeRawClient(true);
    const noPayload = ids();
    await insertRun(noPayload.runId, noPayload.thread, noPayload.turn, {
      dispatchMode: "background",
    });
    await claimBackgroundRun(noPayload.runId);
    await setStaleLiveness(
      noPayload.runId,
      Date.now() - (BACKGROUND_PROCESSING_RUN_STALE_MS + 5_000),
    );
    expect(await reapIfStale(noPayload.runId)).toBe(false);
    expect((await readRow(noPayload.runId))?.status).toBe("running");

    const withPayload = ids();
    await insertRun(withPayload.runId, withPayload.thread, withPayload.turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ threadId: withPayload.thread }),
    });
    await claimBackgroundRun(withPayload.runId);
    await setStaleLiveness(
      withPayload.runId,
      Date.now() - (BACKGROUND_PROCESSING_RUN_STALE_MS + 5_000),
    );
    expect(await reapIfStale(withPayload.runId)).toBe(true);
  });

  it("does NOT create a successor when a newer run already exists for the same turn", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newerRunId = `${runId}-already-continued`;
    await insertRun(newerRunId, thread, turn, { dispatchMode: "background" });

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("newer_run_exists");
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });

  it("does not create a recovery successor after a newer lease generation takes ownership", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    const oldFence = await claimTurnExecutionLease(thread, turn, runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const successorId = `${runId}-successor-owner`;
    await insertRun(successorId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await pglite
      .prepare(
        `UPDATE agent_execution_leases
         SET lease_expires_at = clock_timestamp() - INTERVAL '1 millisecond'
         WHERE thread_id = ? AND turn_id = ?`,
      )
      .run(thread, turn);
    const newFence = await claimTurnExecutionLease(thread, turn, successorId);
    expect(newFence.generation).not.toBe(oldFence.generation);

    expect(await reapIfStale(runId)).toBe(true);

    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain(
      "declined reason=execution_lease_changed",
    );
    expect(await rowsForTurn(turn)).toHaveLength(2);
    expect((await readRow(successorId))?.status).toBe("running");
  });

  it("does not recover into a turn that was cancelled before the stale insert", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);
    const markerId = `turn-abort:${encodeURIComponent(thread)}:${encodeURIComponent(turn)}`;
    await insertRun(markerId, thread, turn, { dispatchMode: "turn-abort" });
    await pglite
      .prepare("UPDATE agent_runs SET status = 'aborted' WHERE id = ?")
      .run(markerId);

    expect(await reapIfStale(runId)).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage).toContain("turn_aborted");
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });

  it("does NOT attempt recovery for a foreground (non-background) run", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn);
    await setStaleLiveness(runId, Date.now() - 60_000);

    const reaped = await reapIfStale(runId);
    expect(reaped).toBe(true);
    expect((await readRow(runId))?.status).toBe("errored");
    expect((await readRow(runId))?.diag_stage ?? "").not.toContain(
      "stale_run_recovery_attempted",
    );
    expect(await rowsForTurn(turn)).toHaveLength(1);
  });

  it("fails closed when stale reaping has no transaction() primitive", async () => {
    currentClient = makeRawClient(false);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    await expect(reapIfStale(runId)).rejects.toThrow(
      "Atomic stale-run fencing requires transaction support",
    );
    expect((await readRow(runId))?.status).toBe("running");
    expect(await rowsForTurn(turn)).toHaveLength(1);
  });

  it("does not append terminal state when the bulk sweep cannot fence a candidate", async () => {
    currentClient = makeRawClient(false);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const swept = await reapAllStaleRuns();

    expect(swept.reaped).toBe(0);
    expect(swept.failed).toBeGreaterThanOrEqual(1);
    expect((await readRow(runId))?.status).toBe("running");
    expect(await rowsForTurn(turn)).toHaveLength(1);
    const eventRows = await pglite
      .prepare(
        "SELECT event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
      )
      .all(runId);
    expect(
      eventRows.some((row) =>
        String(row.event_data).includes('"errorCode":"stale_run"'),
      ),
    ).toBe(false);
  });

  it("surfaces failed recovery instead of confirming a successful reap", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);
    const execute = currentClient.execute.getMockImplementation()!;
    currentClient.execute.mockImplementation(async (input) => {
      if (
        typeof input !== "string" &&
        input.sql.includes("INSERT INTO agent_runs") &&
        input.sql.includes("'background'")
      )
        throw new Error("fixture successor preparation failed");
      return execute(input);
    });
    await expect(reapIfStale(runId)).rejects.toThrow(
      "fixture successor preparation failed",
    );
    expect((await readRow(runId))?.status).toBe("running");
    expect(await rowsForTurn(turn)).toHaveLength(1);
  });

  it("fails closed when a generated stale-run successor ID already exists", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const now = Date.now();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const successorId = `run-${now}-${(0.5).toString(36).slice(2, 8)}`;
    try {
      await insertRun(successorId, "other-thread", "other-turn");
      fireInternalDispatchMock.mockClear();

      await expect(reapIfStale(runId)).rejects.toThrow(
        `Stale-run successor ${successorId} was not inserted`,
      );

      expect((await readRow(runId))?.status).toBe("running");
      expect(await rowsForTurn(turn)).toHaveLength(1);
      expect(fireInternalDispatchMock).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
      dateSpy.mockRestore();
    }
  });

  it("serializes two concurrent reapers for the same turn so the cap is never exceeded", async () => {
    // Two stale rows of the SAME turn reaped at the same moment — e.g. a
    // client's `reapIfStale` poll racing the startup `reapAllStaleRuns`
    // sweep. Before the per-turn `pg_advisory_xact_lock`, both transactions
    // could read the stale-successor count before either had inserted, and
    // both would pass the cap check and create a successor.
    //
    // NOTE ON THIS HARNESS: production's real `DbExec.transaction()` (see
    // `db/client.ts`) checks out a DEDICATED connection from a pool per
    // call, so two concurrent `.transaction()` calls get real, isolated
    // Postgres sessions — exactly what `pg_advisory_xact_lock` is built to
    // serialize. This spec file's mock instead runs every "transaction"
    // through ONE shared PGlite instance with hand-rolled `BEGIN`/`COMMIT`
    // text, so a second concurrent `BEGIN` here never opens a real nested
    // transaction — Postgres just keeps using the first one, merging both
    // reaps' statements into a single visibility scope. Confirmed with
    // tracing: both reaps' own terminal UPDATEs land before EITHER reads
    // the stale-successor count, so both counts come out identical (each
    // sees the other as already-stale), and the two reaps always reach the
    // SAME pass/fail verdict — this harness cannot reproduce "one wins, one
    // loses". What it CAN still assert is the invariant that must never
    // break regardless: the turn never ends up with MORE successors than
    // the cap allows, even when two reaps are launched concurrently.
    currentClient = makeRawClient(true);
    const { thread, turn } = ids();
    const longAgo = Date.now() - STALE_PAST_MS;

    const p1 = `${turn}-p1`;
    const p2 = `${turn}-p2`;
    await seedPriorRun(p1, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo,
    });
    await seedPriorRun(p2, thread, turn, {
      errorCode: "stale_run",
      startedAtMs: longAgo + 1_000,
    });

    const runA = `${turn}-a`;
    const runB = `${turn}-b`;
    await insertRun(runA, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await insertRun(runB, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runA);
    await claimBackgroundRun(runB);
    const sameStartedAt = longAgo + 2_000;
    await pglite
      .prepare(
        `UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
      )
      .run(sameStartedAt, sameStartedAt, sameStartedAt, runA);
    await pglite
      .prepare(
        `UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
      )
      .run(sameStartedAt, sameStartedAt, sameStartedAt, runB);

    const [reapedA, reapedB] = await Promise.all([
      reapIfStale(runA),
      reapIfStale(runB),
    ]);
    expect(reapedA).toBe(true);
    expect(reapedB).toBe(true);

    const rows = await rowsForTurn(turn);
    const knownIds = new Set([p1, p2, runA, runB]);
    const successors = rows.filter((r) => !knownIds.has(r.id));
    // Never more than 1 successor for the turn, however the two concurrent
    // reaps interleave — this is the invariant `pg_advisory_xact_lock`
    // exists to guarantee once each reaper has its own real connection.
    expect(successors.length).toBeLessThanOrEqual(1);
  });
});

describe("FIX 3 — stale-run reaper server-owned recovery (reapAllStaleRuns)", () => {
  it("does not finalize a candidate whose heartbeat renews after the stale scan", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);
    afterStaleCandidateScan = async () => {
      const renewedAt = Date.now();
      await pglite
        .prepare(
          "UPDATE agent_runs SET heartbeat_at = ?, last_progress_at = ? WHERE id = ?",
        )
        .run(renewedAt, renewedAt, runId);
    };

    const swept = await reapAllStaleRuns();

    expect(swept.failed).toBe(0);
    expect((await readRow(runId))?.status).toBe("running");
    const eventRows = await pglite
      .prepare(
        "SELECT event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
      )
      .all(runId);
    expect(
      eventRows.some((row) =>
        String(row.event_data).includes('"errorCode":"stale_run"'),
      ),
    ).toBe(false);
  });

  it("cleanup does not age-fail a run with a live heartbeat", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn);
    const liveAt = Date.now();
    await pglite
      .prepare(
        "UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?",
      )
      .run(liveAt - 2 * 24 * 60 * 60 * 1000, liveAt, liveAt, runId);

    await cleanupOldRuns(24 * 60 * 60 * 1000);

    expect((await readRow(runId))?.status).toBe("running");
    const eventRows = await pglite
      .prepare(
        "SELECT event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
      )
      .all(runId);
    expect(
      eventRows.some((row) =>
        String(row.event_data).includes('"errorCode":"stale_run"'),
      ),
    ).toBe(false);
  });

  it("recovers a dead background worker discovered by the bulk startup sweep", async () => {
    currentClient = makeRawClient(true);
    const { runId, thread, turn } = ids();
    await insertRun(runId, thread, turn, {
      dispatchMode: "background",
      dispatchPayload: JSON.stringify({ ok: true }),
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(runId, Date.now() - STALE_PAST_MS);

    const swept = await reapAllStaleRuns();
    expect(swept.reaped).toBeGreaterThanOrEqual(1);
    expect(swept.failed).toBe(0);
    expect((await readRow(runId))?.status).toBe("errored");
    expect(await rowsForTurn(turn)).toHaveLength(2);

    await reapAllStaleRuns();
    expect(await rowsForTurn(turn)).toHaveLength(2);
  });
});
