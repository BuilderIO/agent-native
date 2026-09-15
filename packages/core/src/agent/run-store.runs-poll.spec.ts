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

let requestUser: string | undefined;
let hasRequestStore = true;
const AMBIENT_DEPLOY_USER = "deploy-bot@example.com";
vi.mock("../server/request-context.js", () => ({
  getRequestContext: () =>
    hasRequestStore ? { userEmail: requestUser } : undefined,
  // Mirrors the real fallback so a regression back to this getter is caught:
  // with no request store it answers with the deployment-wide identity.
  getRequestUserEmail: () =>
    hasRequestStore ? requestUser : AMBIENT_DEPLOY_USER,
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
  requestUser = OWNER;
  hasRequestStore = true;
  rawClient.execute.mockClear();
});

function runsEvents() {
  return recorded.filter((event) => event.source === "runs");
}

describe("runs poll notifications", () => {
  it("scopes the event to the acting caller and the thread's shareable identity", async () => {
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

  it("stays silent when the request has no authenticated user", async () => {
    requestUser = undefined;
    await insertRun("run-orphan", "thread-1", "turn-orphan");
    await settleQuiet();

    // An untagged event would reach every authenticated user, and a
    // resource-tagged one with no owner misses the fast path and drives a
    // detached access query. Neither is worth a poll hint the tray recovers
    // on its own.
    expect(runsEvents()).toHaveLength(0);
  });

  it("never attributes the event to the deployment-wide ambient identity", async () => {
    // A detached worker can finalize a run after the request context has
    // unwound. `getRequestUserEmail()` answers with AGENT_USER_EMAIL there, so
    // the owner fast path would hand a private thread's event to whoever the
    // deploy env names. No caller means no announcement: the tray converges
    // on the terminal status through its own active polling.
    hasRequestStore = false;
    await insertRun("run-detached", "thread-1", "turn-detached");
    await settleQuiet();

    expect(
      runsEvents().some((event) => event.owner === AMBIENT_DEPLOY_USER),
    ).toBe(false);
    expect(runsEvents()).toHaveLength(0);
  });

  it("never queries chat_threads to build the event", async () => {
    // This notifier fires from paths that hold an open transaction on a
    // shared connection, so a stray read that fails aborts the caller's
    // transaction ("current transaction is aborted, commands ignored until
    // end of transaction block"). The caller must come from request context.
    await insertRun("run-1", "thread-1", "turn-1");
    await settle();

    expect(runsEvents()[0]).toMatchObject({ owner: OWNER });
    const statements = rawClient.execute.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input.sql,
    );
    expect(statements.some((sql) => /chat_threads/i.test(sql))).toBe(false);
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
