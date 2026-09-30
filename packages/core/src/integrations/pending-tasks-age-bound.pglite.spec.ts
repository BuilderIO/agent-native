import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

// Real PGlite behind getDbExec, so the sweep's selection, the claim and the
// thread's next-task lookup run their genuine SQL. Only the processor dispatch
// is stubbed.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(input.sql)) {
        const rows = await pglite.prepare(input.sql).all(...args);
        return { rows, rowsAffected: 0 };
      }
      const { changes } = await pglite.prepare(input.sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
  }),
}));

const dispatchPendingTaskMock = vi.hoisted(() =>
  vi.fn(async () => "portable-unconfirmed"),
);

vi.mock("./integration-durable-dispatch.js", () => ({
  configuredIntegrationDurableDispatchScopes: () => null,
  dispatchPendingIntegrationTask: dispatchPendingTaskMock,
  isIntegrationDurableDispatchEnabledForTask: () => false,
}));

vi.mock("./integration-campaigns-store.js", () => ({
  hasActiveIntegrationCampaign: async () => false,
}));

const { retryStuckPendingTasks } = await import("./pending-tasks-retry-job.js");
const {
  claimPendingTask,
  ensurePendingTasksTable,
  getNextPendingTaskForThread,
} = await import("./pending-tasks-store.js");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface SeedRow {
  id: string;
  thread: string;
  status: "pending" | "processing";
  attempts: number;
  createdAgo: number;
  updatedAgo: number;
}

async function seed(rows: SeedRow[]): Promise<number> {
  const now = Date.now();
  for (const row of rows) {
    await pglite.query(
      `INSERT INTO integration_pending_tasks
         (id, platform, external_thread_id, payload, owner_email, status,
          attempts, created_at, updated_at)
       VALUES (?, 'slack', ?, '{}', 'owner@example.com', ?, ?, ?, ?)`,
      [
        row.id,
        row.thread,
        row.status,
        row.attempts,
        now - row.createdAgo,
        now - row.updatedAgo,
      ],
    );
  }
  return now;
}

async function readRow(id: string) {
  const result = await pglite.query(
    `SELECT status, attempts, updated_at FROM integration_pending_tasks WHERE id = ?`,
    [id],
  );
  const row = result.rows[0] as {
    status: string;
    attempts: number | string;
    updated_at: number | string;
  };
  return {
    status: row.status,
    attempts: Number(row.attempts),
    updatedAt: Number(row.updated_at),
  };
}

describe("pending task age bound", () => {
  beforeAll(async () => {
    pglite = await createTestPglite();
    await ensurePendingTasksTable();
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.exec(`DELETE FROM integration_pending_tasks`);
    dispatchPendingTaskMock.mockClear();
  });

  it("recovers stuck work from the last day and leaves older rows untouched", async () => {
    const now = await seed([
      // Weeks-old work behind a recovery path that never reached the
      // processor: one partly retried, one queued behind it in its thread.
      {
        id: "stale-retried",
        thread: "T1:team:C1:1.0",
        status: "pending",
        attempts: 2,
        createdAgo: 50 * DAY,
        updatedAgo: 2 * MINUTE,
      },
      {
        id: "stale-queued",
        thread: "T1:team:C1:1.0",
        status: "pending",
        attempts: 0,
        createdAgo: 50 * DAY - MINUTE,
        updatedAgo: 2 * MINUTE,
      },
      {
        id: "stale-processing",
        thread: "T1:team:C2:1.0",
        status: "processing",
        attempts: 1,
        createdAgo: 2 * DAY,
        updatedAgo: 30 * MINUTE,
      },
      {
        id: "recent-pending",
        thread: "T1:team:C3:1.0",
        status: "pending",
        attempts: 0,
        createdAgo: 5 * MINUTE,
        updatedAgo: 5 * MINUTE,
      },
      {
        id: "within-day-processing",
        thread: "T1:team:C4:1.0",
        status: "processing",
        attempts: 1,
        createdAgo: DAY - 30 * MINUTE,
        updatedAgo: 30 * MINUTE,
      },
    ]);

    const result = await retryStuckPendingTasks({
      webhookBaseUrl: "https://deploy.test",
    });

    expect(result).toMatchObject({ selected: 2, dispatched: 2 });
    expect(
      dispatchPendingTaskMock.mock.calls
        .map(([input]) => (input as { taskId: string }).taskId)
        .sort(),
    ).toEqual(["recent-pending", "within-day-processing"]);
    expect(await readRow("within-day-processing")).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    expect(await readRow("stale-retried")).toEqual({
      status: "pending",
      attempts: 2,
      updatedAt: now - 2 * MINUTE,
    });
    expect(await readRow("stale-queued")).toEqual({
      status: "pending",
      attempts: 0,
      updatedAt: now - 2 * MINUTE,
    });
    expect(await readRow("stale-processing")).toEqual({
      status: "processing",
      attempts: 1,
      updatedAt: now - 30 * MINUTE,
    });
  });

  it("does not mark old rows failed at the retry cap", async () => {
    const now = await seed([
      {
        id: "stale-at-cap",
        thread: "T1:team:C1:1.0",
        status: "pending",
        attempts: 3,
        createdAgo: 3 * DAY,
        updatedAgo: 10 * MINUTE,
      },
    ]);

    const result = await retryStuckPendingTasks({
      webhookBaseUrl: "https://deploy.test",
    });

    expect(result).toMatchObject({ selected: 0, markedFailed: 0 });
    expect(await readRow("stale-at-cap")).toEqual({
      status: "pending",
      attempts: 3,
      updatedAt: now - 10 * MINUTE,
    });
  });

  it("runs a new message behind an expired row in its thread and leaves that row alone", async () => {
    const thread = "T1:team:C1:1.0";
    const now = await seed([
      {
        id: "stale-retried",
        thread,
        status: "pending",
        attempts: 2,
        createdAgo: 50 * DAY,
        updatedAgo: 2 * MINUTE,
      },
      {
        id: "new-message",
        thread,
        status: "pending",
        attempts: 0,
        createdAgo: MINUTE,
        updatedAgo: MINUTE,
      },
    ]);

    expect(await claimPendingTask("stale-retried")).toBeNull();
    expect(await claimPendingTask("new-message")).toMatchObject({
      id: "new-message",
      status: "processing",
    });
    expect(await getNextPendingTaskForThread("slack", thread)).toBeNull();
    expect(await readRow("stale-retried")).toEqual({
      status: "pending",
      attempts: 2,
      updatedAt: now - 2 * MINUTE,
    });
  });

  it("keeps thread order among rows from the last day", async () => {
    const thread = "T1:team:C1:1.0";
    await seed([
      {
        id: "earlier",
        thread,
        status: "pending",
        attempts: 0,
        createdAgo: DAY - MINUTE,
        updatedAgo: DAY - MINUTE,
      },
      {
        id: "later",
        thread,
        status: "pending",
        attempts: 0,
        createdAgo: MINUTE,
        updatedAgo: MINUTE,
      },
    ]);

    expect(await claimPendingTask("later")).toBeNull();
    expect(await getNextPendingTaskForThread("slack", thread)).toMatchObject({
      id: "earlier",
    });
    expect(await claimPendingTask("earlier")).toMatchObject({ id: "earlier" });
  });

  it("still holds the thread for an old processing row with recent activity", async () => {
    await seed([
      {
        id: "active-old",
        thread: "T1:team:C1:1.0",
        status: "processing",
        attempts: 1,
        createdAgo: DAY + 10 * MINUTE,
        updatedAgo: 10 * MINUTE,
      },
      {
        id: "behind-active",
        thread: "T1:team:C1:1.0",
        status: "pending",
        attempts: 0,
        createdAgo: MINUTE,
        updatedAgo: MINUTE,
      },
      {
        id: "abandoned-old",
        thread: "T1:team:C2:1.0",
        status: "processing",
        attempts: 1,
        createdAgo: 3 * DAY,
        updatedAgo: 2 * DAY,
      },
      {
        id: "behind-abandoned",
        thread: "T1:team:C2:1.0",
        status: "pending",
        attempts: 0,
        createdAgo: MINUTE,
        updatedAgo: MINUTE,
      },
    ]);

    expect(await claimPendingTask("behind-active")).toBeNull();
    expect(await claimPendingTask("behind-abandoned")).toMatchObject({
      id: "behind-abandoned",
    });
  });
});
