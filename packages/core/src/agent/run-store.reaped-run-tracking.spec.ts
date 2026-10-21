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
import { withExecutionFence } from "./execution-fence.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const failing = vi.hoisted(() => ({ initiatorRead: false }));
const trackingReads = { initiators: 0 };

function execute(input: Parameters<DbExec["execute"]>[0]) {
  if (typeof input === "string") {
    return pglite.exec(input).then(() => ({ rows: [], rowsAffected: 0 }));
  }
  if (failing.initiatorRead && /FROM agent_turn_initiators/.test(input.sql)) {
    return Promise.reject(new Error("initiator read failed"));
  }
  if (
    /FROM agent_turn_initiators WHERE \(thread_id, turn_id\) IN/.test(input.sql)
  )
    trackingReads.initiators += 1;
  return pglite.query(input.sql, input.args ?? []).then((result) => ({
    rows: result.rows as any[],
    rowsAffected: result.affectedRows ?? 0,
  }));
}

const client = {
  execute,
  transaction: <T>(fn: (tx: DbExec) => Promise<T>) => pglite.transaction(fn),
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
  reapIfStale,
  reapAllStaleRuns,
  reapUnclaimedBackgroundRun,
  cleanupOldRuns,
  updateRunStatusIfRunning,
  reconcileTerminalRunFromEvents,
  insertRunEvent,
  claimTurnExecutionLease,
  STALE_RUN_TERMINAL_REASON,
  __resetNoRunningRunsProbeForTests,
} = await import("./run-store.js");

let events: TrackingEvent[] = [];
let handedWork: Promise<unknown>[] = [];
let providerMode: "ok" | "throw" | "reject" = "ok";

beforeEach(() => {
  events = [];
  providerMode = "ok";
  failing.initiatorRead = false;
  handedWork = [];
  waitUntil.current = (promise) => {
    handedWork.push(promise);
  };
  __resetNoRunningRunsProbeForTests();
  registerTrackingProvider({
    name: "reaped-run-capture",
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
  unregisterTrackingProvider("reaped-run-capture");
});

let seq = 0;
function ids() {
  seq += 1;
  return {
    runId: `run-reap-track-${seq}`,
    thread: `thread-reap-track-${seq}`,
    turn: `turn-reap-track-${seq}`,
  };
}

const INITIATOR = {
  email: "ada@acme-corp.io",
  authUserId: "auth-user-ada",
  anonymous: false,
};

async function seedRun(
  opts: {
    ageMs: number;
    dispatchMode?: "foreground" | "background";
    initiator?: boolean | typeof INITIATOR;
  } = { ageMs: 10 * 60_000 },
) {
  const { runId, thread, turn } = ids();
  await insertRun(runId, thread, turn, {
    dispatchMode: opts.dispatchMode ?? "foreground",
    ...(opts.initiator === false
      ? {}
      : {
          turnInitiator:
            typeof opts.initiator === "object" ? opts.initiator : INITIATOR,
        }),
  });
  const at = Date.now() - opts.ageMs;
  await pglite.query(
    `UPDATE agent_runs SET started_at = ?, heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    [at - 1_000, at, at, runId],
  );
  return { runId, thread, turn, startedAt: at - 1_000, livenessAt: at };
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

describe("reaped runs emit agent_run_terminal", () => {
  it("reapIfStale emits exactly one reaped terminal with the run's ids and initiator", async () => {
    const run = await seedRun();

    expect(await reapIfStale(run.runId, 60_000)).toBe(true);
    await settledEvents();

    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].properties).toMatchObject({
      source: "agent_run_manager",
      run_id: run.runId,
      thread_id: run.thread,
      turn_id: run.turn,
      status: "errored",
      terminal_reason: STALE_RUN_TERMINAL_REASON,
      error_code: "stale_run",
      dispatch_mode: "foreground",
      duration_ms: run.livenessAt - run.startedAt,
      reaped: true,
      reap_source: "reap-if-stale",
      recovery_outcome: "not_background",
      auth_user_id: INITIATOR.authUserId,
    });
    expect(typeof sent[0].properties.error_cause).toBe("string");
    // The same identity the run's own `run_started` and `$ai_trace` carry.
    expect(sent[0].userId).toBe(INITIATOR.email);
    expect(sent[0].properties.user_id).toBe(INITIATOR.email);
    expect(sent[0].sessionId).toBeUndefined();
  });

  it("reapAllStaleRuns emits once per reaped run with the sweep's source and recovery outcome", async () => {
    const foreground = await seedRun({ ageMs: 2 * 60 * 60_000 });
    const background = await seedRun({
      ageMs: 2 * 60 * 60_000,
      dispatchMode: "background",
    });

    const result = await reapAllStaleRuns();
    await settledEvents();

    expect(result.reaped).toBeGreaterThanOrEqual(2);
    expect(eventsFor(foreground.runId)).toHaveLength(1);
    expect(eventsFor(foreground.runId)[0].properties).toMatchObject({
      reap_source: "reap-all-stale",
      turn_id: foreground.turn,
      recovery_outcome: "not_background",
    });
    expect(eventsFor(background.runId)).toHaveLength(1);
    expect(eventsFor(background.runId)[0].properties).toMatchObject({
      reap_source: "reap-all-stale",
      turn_id: background.turn,
      dispatch_mode: "background",
      // No dispatch payload was stored, so recovery declined.
      recovery_outcome: "declined:not_redispatchable",
    });
  });

  it("reapUnclaimedBackgroundRun emits once with the unclaimed reason", async () => {
    const run = await seedRun({ ageMs: 60_000, dispatchMode: "background" });

    expect(await reapUnclaimedBackgroundRun(run.runId)).toBe(true);
    await settledEvents();

    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].properties).toMatchObject({
      run_id: run.runId,
      thread_id: run.thread,
      turn_id: run.turn,
      status: "errored",
      reaped: true,
      reap_source: "reap-unclaimed-background",
      auth_user_id: INITIATOR.authUserId,
    });
    expect(sent[0].properties.recovery_outcome).toBeUndefined();
  });

  it("cleanupOldRuns emits once per reaped run, even when the same pass prunes the row", async () => {
    const first = await seedRun({ ageMs: 3 * 24 * 60 * 60_000 });
    const second = await seedRun({ ageMs: 3 * 24 * 60 * 60_000 });
    trackingReads.initiators = 0;

    await cleanupOldRuns(24 * 60 * 60_000);
    await settledEvents();

    // One sweep is one initiator read, not one per reaped run.
    expect(trackingReads.initiators).toBe(1);

    const remaining = await pglite.query(
      `SELECT id FROM agent_runs WHERE id IN (?, ?)`,
      [first.runId, second.runId],
    );
    expect(remaining.rows).toHaveLength(0);
    for (const run of [first, second]) {
      const sent = eventsFor(run.runId);
      expect(sent).toHaveLength(1);
      expect(sent[0].properties).toMatchObject({
        thread_id: run.thread,
        turn_id: run.turn,
        terminal_reason: STALE_RUN_TERMINAL_REASON,
        reap_source: "reap-all-stale",
        auth_user_id: INITIATOR.authUserId,
      });
    }
  });

  it("still fires, without a user, when the turn has no initiator row", async () => {
    const run = await seedRun({ ageMs: 10 * 60_000, initiator: false });

    expect(await reapIfStale(run.runId, 60_000)).toBe(true);
    await settledEvents();

    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBeUndefined();
    expect(sent[0].properties.auth_user_id).toBeUndefined();
  });

  it("never takes the reaping request's own user or browser session", async () => {
    const run = await seedRun({ ageMs: 10 * 60_000, initiator: false });

    await runWithRequestContext(
      {
        userEmail: "grace@acme-corp.io",
        authUserId: "auth-user-grace",
        browserSessionId: "session-grace",
      },
      () => reapIfStale(run.runId, 60_000),
    );
    await settledEvents();

    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBeUndefined();
    expect(sent[0].properties.user_id).toBeUndefined();
    expect(sent[0].properties.auth_user_id).toBeUndefined();
    expect(sent[0].properties.session_id).toBeUndefined();
    expect(sent[0].sessionId).toBeUndefined();
  });

  it("credits the turn's initiator, not the reaping request's user", async () => {
    const run = await seedRun({ ageMs: 10 * 60_000 });

    await runWithRequestContext(
      {
        userEmail: "grace@acme-corp.io",
        authUserId: "auth-user-grace",
        browserSessionId: "session-grace",
      },
      () => reapIfStale(run.runId, 60_000),
    );
    await settledEvents();

    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(INITIATOR.email);
    expect(sent[0].properties.auth_user_id).toBe(INITIATOR.authUserId);
    expect(sent[0].sessionId).toBeUndefined();
  });

  it("is not dropped or described by a synthetic or test request that reaps it", async () => {
    const run = await seedRun({ ageMs: 10 * 60_000 });

    await runWithRequestContext(
      {
        userEmail: "qa-test-bot-sweeper@acme-corp.io",
        isSyntheticTraffic: true,
        clientPlatform: "ios",
      },
      () => reapIfStale(run.runId, 60_000),
    );
    await settledEvents();

    const sent = eventsFor(run.runId);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(INITIATOR.email);
    expect(sent[0].properties).not.toHaveProperty("client_platform");
  });

  it("does not fire for a turn a test identity started", async () => {
    const run = await seedRun({
      ageMs: 10 * 60_000,
      initiator: { ...INITIATOR, email: "qa-test-bot-reaper@acme-corp.io" },
    });

    expect(await reapIfStale(run.runId, 60_000)).toBe(true);
    await settledEvents();

    expect(eventsFor(run.runId)).toHaveLength(0);
  });

  it("does not fire for a run that is not stale or already finished, and fires once when reaped twice", async () => {
    const fresh = await seedRun({ ageMs: 0 });
    const done = await seedRun();
    await updateRunStatusIfRunning(done.runId, "completed");
    const stale = await seedRun();

    expect(await reapIfStale(fresh.runId, 60_000)).toBe(false);
    expect(await reapIfStale(done.runId, 60_000)).toBe(false);
    expect(await reapIfStale(stale.runId, 60_000)).toBe(true);
    expect(await reapIfStale(stale.runId, 60_000)).toBe(false);
    await reapAllStaleRuns();
    await settledEvents();

    expect(eventsFor(fresh.runId)).toHaveLength(0);
    expect(eventsFor(done.runId)).toHaveLength(0);
    expect(eventsFor(stale.runId)).toHaveLength(1);
  });

  it("hands the send to the platform's waitUntil so a serverless reap still delivers it", async () => {
    const handed: Promise<unknown>[] = [];
    waitUntil.current = (promise) => handed.push(promise);
    const run = await seedRun();

    expect(await reapIfStale(run.runId, 60_000)).toBe(true);
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(eventsFor(run.runId)).toHaveLength(1);
  });
});

describe("reaped-run tracking never changes the reap", () => {
  it.each(["throw", "reject"] as const)(
    "keeps the reap, recovery and sweep results when the provider %ss",
    async (mode) => {
      providerMode = mode;
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const single = await seedRun({
          ageMs: 10 * 60_000,
          dispatchMode: "background",
        });
        const swept = await seedRun({ ageMs: 2 * 60 * 60_000 });

        expect(await reapIfStale(single.runId, 60_000)).toBe(true);
        const sweep = await reapAllStaleRuns();
        await settledEvents();

        expect(sweep.failed).toBe(0);
        expect(sweep.reaped).toBeGreaterThanOrEqual(1);
        const rows = await pglite.query(
          `SELECT id, status FROM agent_runs WHERE id IN (?, ?)`,
          [single.runId, swept.runId],
        );
        expect(rows.rows.map((row) => row.status)).toEqual([
          "errored",
          "errored",
        ]);
        const diag = await pglite.query(
          `SELECT diag_stage FROM agent_runs WHERE id = ?`,
          [single.runId],
        );
        expect(diag.rows[0].diag_stage).toContain(
          "declined reason=not_redispatchable",
        );
        expect(eventsFor(single.runId)).toHaveLength(1);
        expect(eventsFor(swept.runId)).toHaveLength(1);
      } finally {
        errors.mockRestore();
      }
    },
  );

  it("keeps the reap when the tracking read rejects, and reports it", async () => {
    failing.initiatorRead = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await seedRun();

      expect(await reapIfStale(run.runId, 60_000)).toBe(true);
      await settledEvents();

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

  it("keeps the reap when the platform's waitUntil throws", async () => {
    waitUntil.current = () => {
      throw new Error("waitUntil threw");
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await seedRun();

      expect(await reapIfStale(run.runId, 60_000)).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });
});

describe("a reap and the run's own process report one terminal", () => {
  it("leaves the reaped run's process nothing to write or report", async () => {
    const run = await seedRun();
    expect(await reapIfStale(run.runId, 60_000)).toBe(true);
    await pglite.query(
      `INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?)`,
      [run.runId, 10, Date.now(), JSON.stringify({ type: "done" })],
    );

    // Its lease is gone, so it holds no fence to repair the row with.
    expect(await updateRunStatusIfRunning(run.runId, "completed")).toBe(false);
    expect(await reconcileTerminalRunFromEvents(run.runId)).toBe(false);
    await settledEvents();

    expect(eventsFor(run.runId).map((e) => e.properties)).toMatchObject([
      { status: "errored", reaped: true },
    ]);
  });

  it("does not report a repair the run's own process makes of its own row", async () => {
    const run = await seedRun({ ageMs: 0 });
    await insertRunEvent(run.runId, 0, JSON.stringify({ type: "done" }));
    const fence = await claimTurnExecutionLease(
      run.thread,
      run.turn,
      run.runId,
    );

    expect(
      await withExecutionFence(fence, () =>
        reconcileTerminalRunFromEvents(run.runId),
      ),
    ).toBe(true);
    await settledEvents();

    // The run manager sends this run's terminal from its own state.
    expect(eventsFor(run.runId)).toHaveLength(0);
  });
});
