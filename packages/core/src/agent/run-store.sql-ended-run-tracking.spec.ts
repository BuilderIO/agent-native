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
import type { DbExec } from "../db/client.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const failing = vi.hoisted(() => ({
  initiatorRead: false,
  retryTransactionOnce: false,
}));
const sqlLog: string[] = [];

function execute(input: Parameters<DbExec["execute"]>[0]) {
  if (typeof input === "string") {
    return pglite.exec(input).then(() => ({ rows: [], rowsAffected: 0 }));
  }
  sqlLog.push(input.sql);
  if (failing.initiatorRead && /FROM agent_turn_initiators/.test(input.sql)) {
    return Promise.reject(new Error("initiator read failed"));
  }
  return pglite.query(input.sql, input.args ?? []).then((result) => ({
    rows: result.rows as any[],
    rowsAffected: result.affectedRows ?? 0,
  }));
}

const client = {
  execute,
  // Mirrors the pooled driver: a dropped connection rolls the attempt back
  // and runs the whole transaction callback again.
  transaction: async <T>(fn: (tx: DbExec) => Promise<T>) => {
    if (failing.retryTransactionOnce) {
      failing.retryTransactionOnce = false;
      await pglite
        .transaction(async (tx: DbExec) => {
          await fn(tx);
          throw new Error("connection dropped before commit");
        })
        .catch(() => {});
    }
    return pglite.transaction(fn);
  },
} as unknown as DbExec;

vi.mock("../db/client.js", () => ({
  getDbExec: () => client,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: vi.fn(async () => {}),
}));

const waitUntil = vi.hoisted(() => ({
  current: undefined as ((promise: Promise<unknown>) => void) | undefined,
}));
vi.mock("../server/background-work.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/background-work.js")>()),
  platformWaitUntil: () => waitUntil.current,
}));

const {
  insertRun,
  insertRunEvent,
  claimBackgroundRun,
  releaseBackgroundRunBeforeStart,
  finalizeClaimedBackgroundRunFailure,
  failRunBeforeDispatch,
  markRunAbortedAtSafeBoundary,
  CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT,
  reapIfStale,
  STALE_RUN_TERMINAL_REASON,
  markRunAborted,
  markTurnAborted,
  updateRunStatusIfRunning,
  reconcileTerminalRunFromEvents,
  __resetNoRunningRunsProbeForTests,
} = await import("./run-store.js");
const { startRun, abortRun, abortRunDurably, abortTurnByRefDurably } =
  await import("./run-manager.js");

let events: TrackingEvent[] = [];
let handedWork: Promise<unknown>[] = [];
let providerMode: "ok" | "throw" | "reject" = "ok";

beforeEach(() => {
  events = [];
  providerMode = "ok";
  failing.initiatorRead = false;
  failing.retryTransactionOnce = false;
  handedWork = [];
  waitUntil.current = (promise) => {
    handedWork.push(promise);
  };
  __resetNoRunningRunsProbeForTests();
  registerTrackingProvider({
    name: "aborted-run-capture",
    track(event) {
      if (event.name === "agent_run_terminal") events.push(event);
      if (providerMode === "throw") throw new Error("provider threw");
      if (providerMode === "reject") {
        return Promise.reject(new Error("provider rejected"));
      }
    },
  });
});

afterEach(() => {
  unregisterTrackingProvider("aborted-run-capture");
});

let seq = 0;
function ids() {
  seq += 1;
  return {
    runId: `run-abort-track-${seq}`,
    thread: `thread-abort-track-${seq}`,
    turn: `turn-abort-track-${seq}`,
  };
}

const INITIATOR = {
  email: "ada@acme-corp.io",
  authUserId: "auth-user-ada",
  anonymous: false,
};

async function seedRun(
  base = ids(),
  initiator: typeof INITIATOR = INITIATOR,
  runId = base.runId,
) {
  await insertRun(runId, base.thread, base.turn, {
    dispatchMode: "foreground",
    turnInitiator: initiator,
  });
  return { ...base, runId };
}

/**
 * Waits for every send handed to `waitUntil`, however slow, so a "must not
 * fire" assertion cannot pass just because the send had not happened yet.
 */
async function settledEvents(): Promise<TrackingEvent[]> {
  for (let seen = -1; seen !== handedWork.length; ) {
    seen = handedWork.length;
    await Promise.all(handedWork);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  return events;
}

function eventsFor(runId: string) {
  return events.filter((event) => event.properties.run_id === runId);
}

async function statusOf(runId: string) {
  const { rows } = await pglite.query<{ status: string }>(
    `SELECT status FROM agent_runs WHERE id = ?`,
    [runId],
  );
  return rows[0]?.status;
}

describe("a stopped run emits agent_run_terminal", () => {
  it("markRunAborted emits exactly one aborted terminal with the run's ids and initiator", async () => {
    const run = await seedRun();

    await markRunAborted(run.runId, "user");
    await settledEvents();

    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].properties).toMatchObject({
      source: "agent_run_manager",
      run_id: run.runId,
      thread_id: run.thread,
      turn_id: run.turn,
      status: "aborted",
      terminal_reason: "aborted:user",
      abort_reason: "user",
      dispatch_mode: "foreground",
      auth_user_id: INITIATOR.authUserId,
    });
    expect(sent[0].properties.reaped).toBeUndefined();
    expect(sent[0].properties.error_code).toBeUndefined();
    expect(sent[0].userId).toBe(INITIATOR.email);
    expect(sent[0].sessionId).toBeUndefined();
  });

  it.each(["duplicate_submission", "execution-lease-busy"])(
    "does not fire for a request aborted as %s, which never became a run",
    async (reason) => {
      const run = await seedRun();

      expect(await markRunAborted(run.runId, reason)).toBe(true);
      await settledEvents();

      expect(await statusOf(run.runId)).toBe("aborted");
      expect(eventsFor(run.runId)).toHaveLength(0);
    },
  );

  it("fires for a run aborted because its execution lease could not be claimed", async () => {
    const run = await seedRun();

    expect(
      await markRunAborted(run.runId, "execution-lease-claim-failed"),
    ).toBe(true);
    await settledEvents();

    // Nothing replaces it, so this is the only report of the user's turn.
    expect(eventsFor(run.runId).map((e) => e.properties)).toMatchObject([
      { status: "aborted", abort_reason: "execution-lease-claim-failed" },
    ]);
  });

  it("reads the turn's initiator only after the stop's own ledger write", async () => {
    const run = await seedRun();
    sqlLog.length = 0;

    await markRunAborted(run.runId, "user");
    await settledEvents();

    const ledgerWrite = sqlLog.findIndex((sql) =>
      /INSERT INTO agent_run_events/.test(sql),
    );
    const initiatorRead = sqlLog.findIndex((sql) =>
      /FROM agent_turn_initiators WHERE \(thread_id, turn_id\) IN/.test(sql),
    );
    expect(ledgerWrite).toBeGreaterThanOrEqual(0);
    expect(initiatorRead).toBeGreaterThan(ledgerWrite);
  });

  it("carries a non-user abort reason through", async () => {
    const run = await seedRun();

    await markRunAborted(run.runId, "displaced");
    await settledEvents();

    expect(eventsFor(run.runId).map((e) => e.properties)).toMatchObject([
      { abort_reason: "displaced", terminal_reason: "aborted:displaced" },
    ]);
  });

  it("does not fire for a run that already finished, and fires once when stopped twice", async () => {
    const done = await seedRun();
    expect(await updateRunStatusIfRunning(done.runId, "completed")).toBe(true);
    const twice = await seedRun();

    await markRunAborted(done.runId, "user");
    await markRunAborted(twice.runId, "user");
    await markRunAborted(twice.runId, "user");
    await settledEvents();

    expect(await statusOf(done.runId)).toBe("completed");
    expect(eventsFor(done.runId)).toHaveLength(0);
    expect(eventsFor(twice.runId)).toHaveLength(1);
  });

  it("markTurnAborted reports each run once when the driver retries its transaction", async () => {
    const base = ids();
    const first = await seedRun(base);
    const second = await seedRun(base, INITIATOR, `${base.runId}-b`);
    failing.retryTransactionOnce = true;

    expect(await markTurnAborted(base.thread, base.turn, "user")).toBe(
      "aborted",
    );
    await settledEvents();

    expect(failing.retryTransactionOnce).toBe(false);
    expect(eventsFor(first.runId)).toHaveLength(1);
    expect(eventsFor(second.runId)).toHaveLength(1);
  });

  it("markTurnAborted emits once per running run of the turn and never for its markers", async () => {
    const base = ids();
    const first = await seedRun(base);
    const second = await seedRun(base, INITIATOR, `${base.runId}-b`);
    const finished = await seedRun(base, INITIATOR, `${base.runId}-c`);
    expect(await updateRunStatusIfRunning(finished.runId, "completed")).toBe(
      true,
    );

    expect(await markTurnAborted(base.thread, base.turn, "user")).toBe(
      "aborted",
    );
    await settledEvents();

    expect(eventsFor(first.runId)).toHaveLength(1);
    expect(eventsFor(second.runId)).toHaveLength(1);
    expect(eventsFor(finished.runId)).toHaveLength(0);
    // The turn-abort marker rows are bookkeeping, not runs.
    expect(
      events.filter((e) => e.properties.thread_id === base.thread),
    ).toHaveLength(2);
    expect(eventsFor(first.runId)[0].properties).toMatchObject({
      status: "aborted",
      turn_id: base.turn,
      abort_reason: "user",
    });

    // Stopping the same turn again ends nothing new.
    await markTurnAborted(base.thread, base.turn, "user");
    await settledEvents();
    expect(
      events.filter((e) => e.properties.thread_id === base.thread),
    ).toHaveLength(2);
  });

  it("does not fire for a turn a test identity started", async () => {
    const run = await seedRun(ids(), {
      email: "someone@example.test",
      authUserId: "auth-test",
      anonymous: false,
    });

    await markRunAborted(run.runId, "user");
    await settledEvents();

    expect(await statusOf(run.runId)).toBe("aborted");
    expect(eventsFor(run.runId)).toHaveLength(0);
  });

  it("hands the send to the platform's waitUntil so a serverless stop still delivers it", async () => {
    const handed: Promise<unknown>[] = [];
    waitUntil.current = (promise) => handed.push(promise);
    const run = await seedRun();

    await markRunAborted(run.runId, "user");
    await Promise.all(handed);

    expect(handed).toHaveLength(1);
    expect(eventsFor(run.runId)).toHaveLength(1);
  });
});

describe("stop tracking never changes the stop", () => {
  it.each(["throw", "reject"] as const)(
    "keeps the stop when the provider %ss",
    async (mode) => {
      providerMode = mode;
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const run = await seedRun();
        const base = ids();
        const turnRun = await seedRun(base);

        await markRunAborted(run.runId, "user");
        expect(await markTurnAborted(base.thread, base.turn, "user")).toBe(
          "aborted",
        );
        await settledEvents();

        expect(await statusOf(run.runId)).toBe("aborted");
        expect(await statusOf(turnRun.runId)).toBe("aborted");
        expect(eventsFor(run.runId)).toHaveLength(1);
        expect(eventsFor(turnRun.runId)).toHaveLength(1);
      } finally {
        errors.mockRestore();
      }
    },
  );

  it("keeps the stop when the tracking read rejects, and reports it", async () => {
    failing.initiatorRead = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await seedRun();

      await markRunAborted(run.runId, "user");
      await settledEvents();

      expect(await statusOf(run.runId)).toBe("aborted");
      expect(eventsFor(run.runId)).toHaveLength(0);
      expect(
        errors.mock.calls.some(
          ([message, id]) =>
            String(message).includes("run ended in SQL") && id === run.runId,
        ),
      ).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("keeps the stop when the platform's waitUntil throws", async () => {
    waitUntil.current = () => {
      throw new Error("waitUntil threw");
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await seedRun();
      const base = ids();
      await seedRun(base);

      await expect(markRunAborted(run.runId, "user")).resolves.toBe(true);
      await expect(
        markTurnAborted(base.thread, base.turn, "user"),
      ).resolves.toBe("aborted");
      expect(await statusOf(run.runId)).toBe("aborted");
    } finally {
      errors.mockRestore();
    }
  });
});

describe("a stop and the run's own process report one terminal", () => {
  it("a stop that lands first leaves the process nothing to report", async () => {
    const run = await seedRun();
    await markRunAborted(run.runId, "user");

    // What the run's process does next: its conditional write and repair.
    expect(await updateRunStatusIfRunning(run.runId, "aborted")).toBe(false);
    expect(await reconcileTerminalRunFromEvents(run.runId)).toBe(false);
    await settledEvents();
    expect(await statusOf(run.runId)).toBe("aborted");
    expect(eventsFor(run.runId)).toHaveLength(1);
  });

  it("a process that finished first leaves the stop nothing to report", async () => {
    const run = await seedRun();
    expect(await updateRunStatusIfRunning(run.runId, "completed")).toBe(true);

    await markRunAborted(run.runId, "user");
    await settledEvents();

    expect(eventsFor(run.runId)).toHaveLength(0);
  });

  it.each([
    // Does not wait for its SQL stop, so the run loop may report first.
    ["abortRun", (run: { runId: string }) => abortRun(run.runId)],
    ["abortRunDurably", (run: { runId: string }) => abortRunDurably(run.runId)],
    [
      "abortTurnByRefDurably",
      (run: { thread: string; turn: string }) =>
        abortTurnByRefDurably(run.thread, run.turn),
    ],
  ] as const)(
    "stopping a live run with %s emits exactly one aborted terminal",
    async (_name, stop) => {
      const run = ids();
      let started!: () => void;
      const running = new Promise<void>((resolve) => (started = resolve));
      const live = startRun(
        run.runId,
        run.thread,
        async (_send, signal) => {
          started();
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        undefined,
        {
          softTimeoutMs: 0,
          turnId: run.turn,
          dispatchMode: "foreground",
          turnInitiator: INITIATOR,
        },
      );
      await running;
      await vi.waitFor(async () =>
        expect(await statusOf(run.runId)).toBe("running"),
      );

      await stop(run as never);
      // The run's own process has finished its terminal write and repair, so
      // a second report from it would already be here.
      await live.finalized;
      await settledEvents();

      expect(await statusOf(run.runId)).toBe("aborted");
      expect(eventsFor(run.runId)).toHaveLength(1);
      expect(eventsFor(run.runId)[0].properties).toMatchObject({
        status: "aborted",
        turn_id: run.turn,
        abort_reason: "user",
      });
    },
  );

  it("a stop from another process, seen by the run's poll, reports once", async () => {
    const run = ids();
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const live = startRun(
      run.runId,
      run.thread,
      async (_send, signal) => {
        started();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      undefined,
      {
        softTimeoutMs: 0,
        turnId: run.turn,
        dispatchMode: "foreground",
        turnInitiator: INITIATOR,
      },
    );
    await running;
    await vi.waitFor(async () =>
      expect(await statusOf(run.runId)).toBe("running"),
    );

    // Only SQL: the in-memory run learns of it from its own abort poll.
    await markTurnAborted(run.thread, run.turn, "user");
    await live.finalized;
    await settledEvents();

    expect(eventsFor(run.runId)).toHaveLength(1);
    expect(eventsFor(run.runId)[0].properties).toMatchObject({
      status: "aborted",
      abort_reason: "user",
      user_id: INITIATOR.email,
    });
  }, 15_000);

  it("a turn stop that closes a finished continuation chunk does not report the chunk again", async () => {
    const run = await seedRun();
    // The chunk already reported its own terminal when it was truncated.
    await pglite.query(
      `UPDATE agent_runs SET status = 'truncated', terminal_reason = 'auto_continue', completed_at = ? WHERE id = ?`,
      [Date.now(), run.runId],
    );

    await markTurnAborted(run.thread, run.turn, "user");
    await settledEvents();

    expect(await statusOf(run.runId)).toBe("aborted");
    expect(eventsFor(run.runId)).toHaveLength(0);
  });
});

async function writeLedgerTerminal(runId: string, event: object) {
  // `insertRunEvent` refuses a row that is no longer running; that is the
  // state these repairs exist for, so the event goes in while it still runs.
  await insertRunEvent(runId, 0, JSON.stringify(event));
}

async function makeStale(runId: string) {
  await pglite.query(
    `UPDATE agent_runs SET heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    [Date.now() - 10 * 60_000, Date.now() - 10 * 60_000, runId],
  );
}

describe("the reaper's repair reports the run its process could not", () => {
  it("reports a stale run whose ledger already finished as finished, not reaped", async () => {
    const run = await seedRun();
    await writeLedgerTerminal(run.runId, { type: "done" });
    await makeStale(run.runId);

    expect(await reapIfStale(run.runId, 60_000)).toBe(false);
    await settledEvents();

    expect(await statusOf(run.runId)).toBe("completed");
    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].properties).toMatchObject({
      run_id: run.runId,
      thread_id: run.thread,
      turn_id: run.turn,
      status: "completed",
      terminal_reason: "done",
      auth_user_id: INITIATOR.authUserId,
    });
    expect(sent[0].properties.reaped).toBeUndefined();
    expect(sent[0].properties.error_code).toBeUndefined();
    expect(sent[0].sessionId).toBeUndefined();
  });

  it("carries the ledger's failure code", async () => {
    const run = await seedRun();
    await writeLedgerTerminal(run.runId, {
      type: "error",
      error: "boom",
      errorCode: "provider_overloaded",
    });
    await makeStale(run.runId);

    expect(await reapIfStale(run.runId, 60_000)).toBe(false);
    await settledEvents();

    expect(eventsFor(run.runId).map((e) => e.properties)).toMatchObject([
      {
        status: "errored",
        error_code: "provider_overloaded",
        terminal_reason: "error:provider_overloaded",
      },
    ]);
  });

  it("does not emit again when the reaper finds the row already repaired", async () => {
    const run = await seedRun();
    await writeLedgerTerminal(run.runId, { type: "done" });
    await makeStale(run.runId);

    expect(await reapIfStale(run.runId, 60_000)).toBe(false);
    expect(await reapIfStale(run.runId, 60_000)).toBe(false);
    await settledEvents();

    expect(eventsFor(run.runId)).toHaveLength(1);
  });

  it("keeps the repair when the tracking read rejects", async () => {
    failing.initiatorRead = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await seedRun();
      await writeLedgerTerminal(run.runId, { type: "done" });
      await makeStale(run.runId);

      expect(await reapIfStale(run.runId, 60_000)).toBe(false);
      await settledEvents();

      expect(await statusOf(run.runId)).toBe("completed");
      expect(eventsFor(run.runId)).toHaveLength(0);
    } finally {
      errors.mockRestore();
    }
  });
});

describe("a background worker released before it starts reports once", () => {
  async function seedClaimedBackgroundRun() {
    const run = ids();
    await insertRun(run.runId, run.thread, run.turn, {
      dispatchMode: "background",
      turnInitiator: INITIATOR,
    });
    expect(await claimBackgroundRun(run.runId)).toBe(true);
    return run;
  }

  it("emits one errored terminal with the release's code", async () => {
    const run = await seedClaimedBackgroundRun();

    await releaseBackgroundRunBeforeStart(
      run.runId,
      "scheduler_lease_lost",
      "lease lost",
    );
    await settledEvents();

    expect(await statusOf(run.runId)).toBe("errored");
    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].properties).toMatchObject({
      run_id: run.runId,
      turn_id: run.turn,
      status: "errored",
      error_code: "scheduler_lease_lost",
      terminal_reason: "error:scheduler_lease_lost",
      dispatch_mode: "background-processing",
      auth_user_id: INITIATOR.authUserId,
    });
    expect(JSON.stringify(sent[0].properties)).not.toContain("lease lost");
  });

  it("does not emit when there was no unstarted worker row to release", async () => {
    const run = await seedClaimedBackgroundRun();
    await releaseBackgroundRunBeforeStart(
      run.runId,
      "scheduler_lease_lost",
      "x",
    );
    const foreground = await seedRun();

    await expect(
      releaseBackgroundRunBeforeStart(run.runId, "scheduler_lease_lost", "x"),
    ).rejects.toThrow();
    await expect(
      releaseBackgroundRunBeforeStart(
        foreground.runId,
        "scheduler_lease_lost",
        "x",
      ),
    ).rejects.toThrow();
    await settledEvents();

    expect(eventsFor(run.runId)).toHaveLength(1);
    expect(eventsFor(foreground.runId)).toHaveLength(0);
  });

  it("keeps the release when the provider throws", async () => {
    providerMode = "throw";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await seedClaimedBackgroundRun();
      await expect(
        releaseBackgroundRunBeforeStart(run.runId, "scheduler_lease_lost", "x"),
      ).resolves.toBeUndefined();
      await settledEvents();
      expect(await statusOf(run.runId)).toBe("errored");
    } finally {
      errors.mockRestore();
    }
  });
});

describe("a run that fails before its worker starts reports once", () => {
  it("a claimed background worker's setup failure emits one errored terminal", async () => {
    const run = ids();
    await insertRun(run.runId, run.thread, run.turn, {
      dispatchMode: "background",
      turnInitiator: INITIATOR,
    });
    expect(await claimBackgroundRun(run.runId)).toBe(true);
    const failure = {
      errorCode: CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.errorCode,
      errorDetail: "setup threw",
      event: CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT,
    };

    expect(await finalizeClaimedBackgroundRunFailure(run.runId, failure)).toBe(
      true,
    );
    expect(await finalizeClaimedBackgroundRunFailure(run.runId, failure)).toBe(
      false,
    );
    await settledEvents();

    expect(eventsFor(run.runId).map((e) => e.properties)).toMatchObject([
      {
        turn_id: run.turn,
        status: "errored",
        error_code: CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.errorCode,
        dispatch_mode: "background-processing",
        auth_user_id: INITIATOR.authUserId,
      },
    ]);
  });

  it("a dispatch with no payload emits one errored terminal", async () => {
    const run = await seedRun();

    expect(
      await failRunBeforeDispatch(
        run.runId,
        "dispatch_payload_missing",
        "payload missing",
        "dispatch_payload_missing",
      ),
    ).toBe(true);
    expect(
      await failRunBeforeDispatch(
        run.runId,
        "dispatch_payload_missing",
        "payload missing",
        "dispatch_payload_missing",
      ),
    ).toBe(false);
    await settledEvents();

    expect(eventsFor(run.runId).map((e) => e.properties)).toMatchObject([
      {
        status: "errored",
        error_code: "dispatch_payload_missing",
        terminal_reason: "dispatch_payload_missing",
      },
    ]);
  });

  it("a stop at a safe boundary emits one aborted terminal", async () => {
    const run = await seedRun();

    expect(await markRunAbortedAtSafeBoundary(run.runId, "user")).toBe(true);
    await settledEvents();

    expect(eventsFor(run.runId).map((e) => e.properties)).toMatchObject([
      { status: "aborted", abort_reason: "user", turn_id: run.turn },
    ]);
  });
});
