import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const rawClient: any = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};
rawClient.transaction = async (
  fn: (tx: typeof rawClient) => Promise<unknown>,
) => {
  await pglite.exec("BEGIN");
  try {
    const result = await fn(rawClient);
    await pglite.exec("COMMIT");
    return result;
  } catch (error) {
    await pglite.exec("ROLLBACK");
    throw error;
  }
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const {
  insertRun,
  claimBackgroundRun,
  tryClaimRunSlot,
  updateRunStatusIfRunning,
  listUnclaimedBackgroundRunIds,
  reapUnclaimedBackgroundRun,
  getRunById,
  getRunByThread,
  getCurrentTurnRunEventsForThread,
  reapIfStale,
  setRunInFlightMarker,
  IN_FLIGHT_RUN_STALE_GRACE_MS,
  IN_FLIGHT_GRACE_MAX_LIVENESS_GAP_MS,
  BACKGROUND_RUN_STALE_MS,
} = await import("./run-store.js");

let seq = 0;
function ids(): { chunk0: string; successor: string; thread: string } {
  seq += 1;
  return {
    chunk0: `run-fg-chunk0-${seq}`,
    successor: `run-fg-next-${seq}`,
    thread: `thread-fg-${seq}`,
  };
}

async function setLiveness(runId: string, atMs: number): Promise<void> {
  await (
    await pglite.prepare(
      `UPDATE agent_runs SET heartbeat_at = ?, started_at = ? WHERE id = ?`,
    )
  ).run(atMs, atMs, runId);
}

async function setStaleLiveness(runId: string, atMs: number): Promise<void> {
  await (
    await pglite.prepare(
      `UPDATE agent_runs SET heartbeat_at = ?, last_progress_at = ? WHERE id = ?`,
    )
  ).run(atMs, atMs, runId);
}

async function readInFlightSince(runId: string): Promise<number | null> {
  const row = (await (
    await pglite.prepare(`SELECT in_flight_since FROM agent_runs WHERE id = ?`)
  ).get(runId)) as { in_flight_since: number | null } | undefined;
  return row?.in_flight_since ?? null;
}

describe("foreground self-chain — pre-inserted successor vs racing client continuation", () => {
  it("orders replay events by continuation position when chunk timestamps tie", async () => {
    const { thread } = ids();
    const turn = `${thread}-turn`;
    const firstChunk = `${turn}-first`;
    const laterChunk = `${turn}-later`;
    await insertRun(laterChunk, thread, turn, { continuationOrder: 1 });
    await insertRun(firstChunk, thread, turn, { continuationOrder: 0 });
    const eventAt = 1_000;
    await pglite
      .prepare(
        `INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
      )
      .run(
        laterChunk,
        0,
        eventAt,
        JSON.stringify({ type: "text", text: "later" }),
        firstChunk,
        0,
        eventAt,
        JSON.stringify({ type: "text", text: "first" }),
      );

    const events = await getCurrentTurnRunEventsForThread(thread, turn);
    expect(events.map((entry) => entry.runId)).toEqual([
      firstChunk,
      laterChunk,
    ]);
  });

  it("tryClaimRunSlot refuses the client's continuation POST while the UNCLAIMED successor holds the slot", async () => {
    const { chunk0, successor, thread } = ids();
    await insertRun(chunk0, thread, "turn-1");
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    await updateRunStatusIfRunning(chunk0, "completed");

    const slot = await tryClaimRunSlot(thread, "run-client-race-1");
    expect(slot.claimed).toBe(false);
    expect(slot.activeRunId).toBe(successor);
  });

  it("tryClaimRunSlot still refuses after the successor worker CLAIMED the run", async () => {
    const { chunk0, successor, thread } = ids();
    await insertRun(chunk0, thread, "turn-1");
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    await updateRunStatusIfRunning(chunk0, "completed");

    expect(await claimBackgroundRun(successor)).toBe(true);

    const slot = await tryClaimRunSlot(thread, "run-client-race-2");
    expect(slot.claimed).toBe(false);
    expect(slot.activeRunId).toBe(successor);
  });

  it("duplicate deliveries of the successor dispatch dedupe via the atomic claim", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    const [a, b] = await Promise.all([
      claimBackgroundRun(successor),
      claimBackgroundRun(successor),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await claimBackgroundRun(successor)).toBe(false);
  });

  it("a LOUDLY failed handoff frees the slot so the client auto_continue fallback can proceed", async () => {
    const { chunk0, successor, thread } = ids();
    await insertRun(chunk0, thread, "turn-1");
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    await updateRunStatusIfRunning(successor, "errored");
    await updateRunStatusIfRunning(chunk0, "errored");

    const slot = await tryClaimRunSlot(thread, "run-client-race-3");
    expect(slot.claimed).toBe(true);
  });
});

describe("foreground self-chain — reaper coverage for the handoff window", () => {
  it("a successor stuck unclaimed past the grace is swept into a loud recoverable error", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    await setLiveness(successor, Date.now() - 60_000);

    const staleIds = await listUnclaimedBackgroundRunIds();
    expect(staleIds).toContain(successor);
    expect(await reapUnclaimedBackgroundRun(successor)).toBe(true);
    expect((await getRunById(successor))?.status).toBe("errored");
    expect(await claimBackgroundRun(successor)).toBe(false);
  });

  it("a FRESH successor (dispatch in flight) is NOT reaped", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    expect(await listUnclaimedBackgroundRunIds()).not.toContain(successor);
    expect(await reapUnclaimedBackgroundRun(successor)).toBe(false);
    expect((await getRunById(successor))?.status).toBe("running");
  });

  it("a redispatched worker that ARRIVES AFTER the row was reaped cannot execute (CAS requires status='running')", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });
    await setLiveness(successor, Date.now() - 60_000);

    expect(await reapUnclaimedBackgroundRun(successor)).toBe(true);
    expect((await getRunById(successor))?.status).toBe("errored");

    expect(await claimBackgroundRun(successor)).toBe(false);
  });

  it("once a redispatched worker CLAIMS the row, a later reap cannot resurrect or double-run it", async () => {
    const { successor, thread } = ids();
    await insertRun(successor, thread, "turn-1", {
      dispatchMode: "background",
    });

    expect(await claimBackgroundRun(successor)).toBe(true);

    await setLiveness(successor, Date.now() - 60_000);
    expect(await reapUnclaimedBackgroundRun(successor)).toBe(false);
    expect((await getRunById(successor))?.status).toBe("running");
    expect(await claimBackgroundRun(successor)).toBe(false);
  });
});

describe("reapIfStale — in-flight grace (in_flight_since)", () => {
  it("setRunInFlightMarker round-trips through real SQL: sets on true, clears on false", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await claimBackgroundRun(runId);
    expect(await readInFlightSince(runId)).toBeNull();

    await setRunInFlightMarker(runId, true);
    const since = await readInFlightSince(runId);
    expect(since).not.toBeNull();
    expect(since).toBeGreaterThan(Date.now() - 5_000);

    await new Promise((r) => setTimeout(r, 5));
    await setRunInFlightMarker(runId, true);
    expect(await readInFlightSince(runId)).toBe(since);

    await setRunInFlightMarker(runId, false);
    expect(await readInFlightSince(runId)).toBeNull();

    await setRunInFlightMarker(runId, true, 111);
    await setRunInFlightMarker(runId, false, 999);
    expect(await readInFlightSince(runId)).toBe(111);
    await setRunInFlightMarker(runId, false, 111);
    expect(await readInFlightSince(runId)).toBeNull();
  });

  it("does NOT reap a background run whose heartbeat lapsed past BACKGROUND_RUN_STALE_MS while in-flight work is within the bounded grace", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(
      runId,
      Date.now() - (BACKGROUND_RUN_STALE_MS + 5_000),
    );
    await setRunInFlightMarker(runId, true);

    const reaped = await reapIfStale(runId);

    expect(reaped).toBe(false);
    expect((await getRunById(runId))?.status).toBe("running");
  });

  it("DOES reap the SAME run loudly once the bounded in-flight grace is exceeded", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(
      runId,
      Date.now() - (BACKGROUND_RUN_STALE_MS + 5_000),
    );
    await pglite
      .prepare(`UPDATE agent_runs SET in_flight_since = ? WHERE id = ?`)
      .run(Date.now() - (IN_FLIGHT_RUN_STALE_GRACE_MS + 5_000), runId);

    const reaped = await reapIfStale(runId);

    expect(reaped).toBe(true);
    const row = await getRunById(runId);
    expect(row?.status).toBe("errored");
    expect(row?.errorCode).toBe("stale_run");
  });

  it("still reaps a background run with NO in-flight work at the ORIGINAL BACKGROUND_RUN_STALE_MS — no weakening of the no-in-flight case", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await claimBackgroundRun(runId);
    await setStaleLiveness(
      runId,
      Date.now() - (BACKGROUND_RUN_STALE_MS + 5_000),
    );
    expect(await readInFlightSince(runId)).toBeNull();

    const reaped = await reapIfStale(runId);

    expect(reaped).toBe(true);
    expect((await getRunById(runId))?.status).toBe("errored");
  });

  it("DOES reap a FRESH in-flight marker whose producer stopped heartbeating past IN_FLIGHT_GRACE_MAX_LIVENESS_GAP_MS", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await claimBackgroundRun(runId);
    await setRunInFlightMarker(runId, true);
    await setStaleLiveness(
      runId,
      Date.now() - (IN_FLIGHT_GRACE_MAX_LIVENESS_GAP_MS + 5_000),
    );
    expect(await readInFlightSince(runId)).toBeGreaterThan(
      Date.now() - IN_FLIGHT_RUN_STALE_GRACE_MS,
    );

    const reaped = await reapIfStale(runId);

    expect(reaped).toBe(true);
    const row = await getRunById(runId);
    expect(row?.status).toBe("errored");
    expect(row?.errorCode).toBe("stale_run");
  });

  it("surfaces hasInFlightWork via getRunByThread's inFlightSince for the /runs/active wire signal", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await claimBackgroundRun(runId);

    let byThread = await getRunByThread(thread);
    expect(byThread?.inFlightSince).toBeNull();

    await setRunInFlightMarker(runId, true);
    byThread = await getRunByThread(thread);
    expect(byThread?.inFlightSince).not.toBeNull();

    await setRunInFlightMarker(runId, false);
    byThread = await getRunByThread(thread);
    expect(byThread?.inFlightSince).toBeNull();
  });

  it("claimBackgroundRun's CAS still rejects a second claimer on a row that also carries an in-flight marker", async () => {
    const { successor: runId, thread } = ids();
    await insertRun(runId, thread, "turn-1", {
      dispatchMode: "background",
    });
    await setRunInFlightMarker(runId, true);

    const [a, b] = await Promise.all([
      claimBackgroundRun(runId),
      claimBackgroundRun(runId),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await claimBackgroundRun(runId)).toBe(false);
  });
});
