import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

/**
 * The Agent runs tray refreshes off the shared `runs` poll source. Two things
 * have to hold for that to be both correct and safe:
 *
 * - every lifecycle transition the tray can render emits an event, including
 *   the abort paths that write `status = 'aborted'` directly instead of going
 *   through `updateRunStatus`, and
 * - the event is scoped. An event with no owner, org, or resource tag is
 *   delivered to every authenticated user, which would fan every tray out on
 *   unrelated private chat activity and put a private thread id in a globally
 *   visible payload.
 */

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

let committedAt = 0;
let tick = 0;
const recorded: Array<Record<string, unknown>> = [];
const recordOrder: number[] = [];

async function exec(input: string | { sql: string; args?: unknown[] }) {
  if (typeof input === "string") {
    await pglite.exec(input);
    return { rows: [] as unknown[], rowsAffected: 0 };
  }
  const stmt = await pglite.prepare(input.sql);
  const args = (input.args ?? []) as unknown[];
  if (/^\s*select/i.test(input.sql) || /\breturning\b/i.test(input.sql)) {
    return { rows: await stmt.all(...args), rowsAffected: 0 };
  }
  const info = await stmt.run(...args);
  return { rows: [] as unknown[], rowsAffected: info.changes };
}

const rawClient = {
  execute: vi.fn(exec),
  // Not a real transaction: it only has to resolve after the callback so the
  // post-commit ordering of the notification is observable.
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const result = await fn({ execute: vi.fn(exec) });
    committedAt = ++tick;
    return result;
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

vi.mock("../server/poll.js", () => ({
  recordChange: vi.fn((event: Record<string, unknown>) => {
    recorded.push(event);
    recordOrder.push(++tick);
  }),
}));

const {
  insertRun,
  updateRunStatus,
  markRunAborted,
  markTurnAborted,
  tryClaimRunSlot,
} = await import("./run-store.js");

const OWNER = "owner@example.com";

/**
 * The notification is fire-and-forget (it resolves the thread owner first), so
 * wait for it rather than sleeping a fixed amount and hoping.
 */
async function settle(expected = 1): Promise<void> {
  await vi
    .waitFor(
      () => expect(runsEvents().length).toBeGreaterThanOrEqual(expected),
      {
        timeout: 2000,
        interval: 10,
      },
    )
    .catch(() => {});
}

/** For the negative case there is nothing to wait for; give it room to fire. */
async function settleQuiet(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

beforeEach(async () => {
  await pglite.exec(`DROP TABLE IF EXISTS chat_threads`);
  await pglite.exec(`DELETE FROM agent_runs`).catch(() => {});
  await pglite.exec(`
    CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost'
    )
  `);
  await pglite.query(
    `INSERT INTO chat_threads (id, owner_email) VALUES (?, ?)`,
    ["thread-1", OWNER],
  );
  recorded.length = 0;
  recordOrder.length = 0;
  committedAt = 0;
  tick = 0;
});

function runsEvents() {
  return recorded.filter((event) => event.source === "runs");
}

describe("runs poll notifications", () => {
  it("scopes the event to the thread owner and its shareable identity", async () => {
    await insertRun("run-1", "thread-1", "turn-1");
    await settle();

    expect(runsEvents()).toHaveLength(1);
    expect(runsEvents()[0]).toMatchObject({
      source: "runs",
      type: "change",
      owner: OWNER,
      resourceType: "chat_thread",
      resourceId: "thread-1",
    });
  });

  it("stays access-gated when the owner cannot be resolved", async () => {
    await insertRun("run-orphan", "thread-missing", "turn-orphan");
    await settle();

    const event = runsEvents()[0];
    // No owner is not a licence to broadcast: an untagged event would be
    // visible to every authenticated user.
    expect(event.owner).toBeUndefined();
    expect(event).toMatchObject({
      resourceType: "chat_thread",
      resourceId: "thread-missing",
    });
  });

  it("announces a terminal status write", async () => {
    await insertRun("run-1", "thread-1", "turn-1");
    await settle();
    recorded.length = 0;

    await updateRunStatus("run-1", "completed");
    await settle();

    expect(runsEvents()).toHaveLength(1);
    expect(runsEvents()[0]).toMatchObject({ resourceId: "thread-1" });
  });

  it("announces an aborted run", async () => {
    await insertRun("run-1", "thread-1", "turn-1");
    await settle();
    recorded.length = 0;

    await markRunAborted("run-1", "user");
    await settle();

    expect(runsEvents()).toHaveLength(1);
    expect(runsEvents()[0]).toMatchObject({
      owner: OWNER,
      resourceId: "thread-1",
    });
  });

  it("announces a turn abort, including the pre-run marker case", async () => {
    await markTurnAborted("thread-1", "turn-never-started", "user");
    await settle();
    expect(runsEvents().length).toBeGreaterThanOrEqual(1);

    recorded.length = 0;
    await insertRun("run-2", "thread-1", "turn-2");
    await settle();
    recorded.length = 0;

    await markTurnAborted("thread-1", "turn-2", "user");
    await settle();
    expect(runsEvents().length).toBeGreaterThanOrEqual(1);
    expect(runsEvents()[0]).toMatchObject({ resourceId: "thread-1" });
  });

  it("announces a claimed slot once, and stays quiet when the claim is lost", async () => {
    const claim = await tryClaimRunSlot("thread-1", "run-claim", undefined, {
      turnId: "turn-claim",
    });
    expect(claim.claimed).toBe(true);
    await settle();
    expect(runsEvents()).toHaveLength(1);
    expect(recordOrder[0]).toBeGreaterThan(committedAt);

    recorded.length = 0;
    // The first run still holds the thread's slot, so nothing new started and
    // there is nothing for a tray to refresh for.
    const contended = await tryClaimRunSlot(
      "thread-1",
      "run-contended",
      undefined,
      { turnId: "turn-contended" },
    );
    await settleQuiet();
    expect(contended.claimed).toBe(false);
    expect(runsEvents()).toHaveLength(0);
  });
});
