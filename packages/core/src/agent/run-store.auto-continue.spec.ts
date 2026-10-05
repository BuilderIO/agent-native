import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { MAX_AUTO_CONTINUES_PER_TURN } from "./auto-continue.js";

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

/** A fresh module instance, as after a page reload or on another server. */
async function freshRunStore() {
  vi.resetModules();
  return import("./run-store.js");
}

let seq = 0;
async function timeLimitStop(): Promise<{
  thread: string;
  turn: string;
  run: string;
}> {
  seq += 1;
  const { insertRun, updateRunStatusIfRunning, setRunTerminalReason } =
    await freshRunStore();
  const thread = `thread-auto-${seq}`;
  const turn = `turn-auto-${seq}`;
  const run = `run-auto-${seq}-0`;
  await insertRun(run, thread, turn, { dispatchMode: "foreground" });
  await updateRunStatusIfRunning(run, "truncated");
  await setRunTerminalReason(run, "run_timeout");
  return { thread, turn, run };
}

async function stopAtTimeLimit(runId: string): Promise<void> {
  const { updateRunStatusIfRunning, setRunTerminalReason } =
    await freshRunStore();
  await updateRunStatusIfRunning(runId, "truncated");
  await setRunTerminalReason(runId, "run_timeout");
}

describe("automatic continuation admission", () => {
  it("starts the continuation in the same turn and records what it continued", async () => {
    const { thread, turn, run } = await timeLimitStop();
    const { tryClaimRunSlot } = await freshRunStore();

    const slot = await tryClaimRunSlot(thread, `${run}-next`, undefined, {
      turnId: turn,
      replayCompletedTurn: true,
      dispatchMode: "foreground",
      autoContinueOf: run,
    });

    expect(slot).toEqual({ claimed: true, activeRunId: null });
    const row = (await (
      await pglite.prepare(
        `SELECT turn_id, auto_continue_of FROM agent_runs WHERE id = ?`,
      )
    ).get(`${run}-next`)) as { turn_id: string; auto_continue_of: string };
    expect(row).toEqual({ turn_id: turn, auto_continue_of: run });
  });

  it("keeps the cap across reloads: the count lives in the turn's rows", async () => {
    const { thread, turn, run } = await timeLimitStop();
    let stopped = run;
    for (let n = 1; n <= MAX_AUTO_CONTINUES_PER_TURN; n += 1) {
      // Every claim comes from a fresh module, like a reloaded page would.
      const { tryClaimRunSlot } = await freshRunStore();
      const next = `${run}-c${n}`;
      const slot = await tryClaimRunSlot(thread, next, undefined, {
        turnId: turn,
        dispatchMode: "foreground",
        autoContinueOf: stopped,
      });
      expect(slot.claimed, `continuation ${n}`).toBe(true);
      await stopAtTimeLimit(next);
      stopped = next;
    }

    const { tryClaimRunSlot } = await freshRunStore();
    const refused = await tryClaimRunSlot(thread, `${run}-over`, undefined, {
      turnId: turn,
      dispatchMode: "foreground",
      autoContinueOf: stopped,
    });
    expect(refused).toEqual({
      claimed: false,
      activeRunId: null,
      autoContinueRefused: "auto_continue_cap_reached",
    });
    const rows = await (
      await pglite.prepare(`SELECT id FROM agent_runs WHERE turn_id = ?`)
    ).all(turn);
    expect(rows).toHaveLength(MAX_AUTO_CONTINUES_PER_TURN + 1);
  });

  it("starts one run when two tabs continue the same stop", async () => {
    const { thread, turn, run } = await timeLimitStop();
    const { tryClaimRunSlot } = await freshRunStore();
    const claim = (id: string) =>
      tryClaimRunSlot(thread, id, undefined, {
        turnId: turn,
        dispatchMode: "foreground",
        autoContinueOf: run,
      });

    const first = await claim(`${run}-tab-a`);
    const second = await claim(`${run}-tab-b`);

    expect(first.claimed).toBe(true);
    expect(second).toMatchObject({
      claimed: false,
      activeRunId: `${run}-tab-a`,
    });
  });

  it("never continues a turn that ended in an error or a stop", async () => {
    const {
      tryClaimRunSlot,
      insertRun,
      updateRunStatusIfRunning,
      setRunTerminalReason,
    } = await freshRunStore();
    for (const [status, reason] of [
      ["errored", "error:provider_rate_limited"],
      ["errored", "missing_api_key"],
      ["aborted", "aborted:user"],
      ["truncated", "stream_ended"],
    ] as const) {
      seq += 1;
      const thread = `thread-refuse-${seq}`;
      const turn = `turn-refuse-${seq}`;
      const run = `run-refuse-${seq}`;
      await insertRun(run, thread, turn, { dispatchMode: "foreground" });
      await updateRunStatusIfRunning(run, status);
      await setRunTerminalReason(run, reason);

      const slot = await tryClaimRunSlot(thread, `${run}-next`, undefined, {
        turnId: turn,
        dispatchMode: "foreground",
        autoContinueOf: run,
      });
      expect(slot, reason).toEqual({
        claimed: false,
        activeRunId: null,
        autoContinueRefused: "auto_continue_unavailable",
      });
    }
  });

  it("answers a stopped turn as stopped, not as continued", async () => {
    const { thread, turn, run } = await timeLimitStop();
    const { tryClaimRunSlot, markTurnAborted } = await freshRunStore();
    await markTurnAborted(thread, turn, "user");

    const slot = await tryClaimRunSlot(thread, `${run}-next`, undefined, {
      turnId: turn,
      dispatchMode: "foreground",
      autoContinueOf: run,
    });

    expect(slot).toEqual({
      claimed: false,
      activeRunId: null,
      turnAborted: true,
    });
  });
});
