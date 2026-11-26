import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { firstRow } from "../server/lib/first-row.js";

const POSTGRES_URL = process.env.CONTENT_ROW_MUTATION_POSTGRES_URL;
const OWNER = "retention-postgres-owner@example.test";
const ORG_ID = "retention-postgres-org";
const SPACE_ID = "retention-postgres-space";
const START = "2030-01-01T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const UNFINISHED = ["queued", "running", "retryable"];

type Db = ReturnType<typeof import("../server/db/index.js").getDb>;
let getDb: () => Db;
let schema: typeof import("../server/db/schema.js");
let purge: typeof import("../server/lib/content-trash-purge.js");
let retention: typeof import("../server/lib/content-trash-retention.js");
let transactionRows: typeof import("./_user-setting-transaction.js").transactionRows;

const at = (days: number, offsetMs = 0) =>
  new Date(Date.parse(START) + days * DAY + offsetMs);

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const databaseName = new URL(POSTGRES_URL).pathname.slice(1);
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(
      "CONTENT_ROW_MUTATION_POSTGRES_URL must name an isolated test database.",
    );
  }
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  purge = await import("../server/lib/content-trash-purge.js");
  retention = await import("../server/lib/content-trash-retention.js");
  ({ transactionRows } = await import("./_user-setting-transaction.js"));
  await (await import("../server/plugins/db.js")).default(undefined as never);
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.contentSpaces)
    .values({
      id: SPACE_ID,
      name: "Retention Postgres workspace",
      kind: "organization",
      ownerEmail: OWNER,
      orgId: ORG_ID,
      filesDatabaseId: `${SPACE_ID}-files`,
      createdBy: OWNER,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}, 60_000);

afterAll(() => {
  delete process.env.DATABASE_URL;
});

async function insertTrashedPage(id: string, trashedAt: Date) {
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    spaceId: SPACE_ID,
    ownerEmail: OWNER,
    orgId: ORG_ID,
    title: id,
    content: "",
    visibility: "private",
    parentId: null,
    trashedAt: trashedAt.toISOString(),
    trashRootId: id,
    trashedBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
}

async function pageExists(id: string) {
  const rows = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return rows.length > 0;
}

async function operation(operationId: string) {
  const rows = await getDb()
    .select()
    .from(schema.contentTrashPurgeOperations)
    .where(eq(schema.contentTrashPurgeOperations.id, operationId));
  const row = rows.find(({ id }) => id === operationId);
  if (!row) throw new Error(`Operation ${operationId} is missing`);
  return row;
}

async function unfinishedOperationIds() {
  const rows = await getDb()
    .select({
      id: schema.contentTrashPurgeOperations.id,
      status: schema.contentTrashPurgeOperations.status,
    })
    .from(schema.contentTrashPurgeOperations)
    .where(
      eq(
        schema.contentTrashPurgeOperations.actorEmail,
        purge.CONTENT_TRASH_RETENTION_ACTOR,
      ),
    );
  return rows
    .filter(({ status }) => UNFINISHED.includes(status))
    .map(({ id }) => id);
}

async function itemOutcomes(operationId: string) {
  const { planId } = await operation(operationId);
  const rows = await getDb()
    .select({ outcome: schema.contentTrashPurgePlanItems.outcome })
    .from(schema.contentTrashPurgePlanItems)
    .where(eq(schema.contentTrashPurgePlanItems.planId, planId));
  return rows.map(({ outcome }) => outcome);
}

async function planFilters(operationId: string) {
  const { planId } = await operation(operationId);
  const rows = await getDb()
    .select({ filtersJson: schema.contentTrashPurgePlans.filtersJson })
    .from(schema.contentTrashPurgePlans)
    .where(eq(schema.contentTrashPurgePlans.id, planId))
    .limit(1);
  const plan = firstRow(rows);
  if (!plan) throw new Error(`Plan ${planId} is missing`);
  return purge.parseContentTrashRetentionPlanFilters(plan.filtersJson);
}

function workOnce(operationId: string) {
  return runWithRequestContext(
    { userEmail: purge.CONTENT_TRASH_RETENTION_ACTOR },
    () => purge.processContentTrashPurge(operationId),
  );
}

async function drain(operationId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await workOnce(operationId);
    if (!UNFINISHED.includes((await operation(operationId)).status)) return;
  }
  throw new Error(`Retention operation ${operationId} never finished`);
}

function run(
  now: Date,
  options: { deferred?: string[]; idleRearmMs?: number } = {},
) {
  const deferred = options.deferred ?? [];
  return retention.runContentTrashRetention({
    deadlineAt: Date.now() + 60_000,
    now,
    idleRearmMs: options.idleRearmMs ?? Number.POSITIVE_INFINITY,
    dispatch: async (operationId) => {
      deferred.push(operationId);
    },
  });
}

async function recordSetting(startedAt: Date, lastSweepAt: Date) {
  await putSetting(retention.CONTENT_TRASH_RETENTION_SETTING_KEY, {
    startedAt: startedAt.toISOString(),
    lastSweepAt: lastSweepAt.toISOString(),
  });
}

async function holdRetentionLock(change?: (tx: Db) => Promise<void>) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held: () => void = () => {};
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const done = getDb().transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    await purge.lockContentTrashRetentionState(tx, "exclusive");
    if (change) await change(tx);
    held();
    await released;
  });
  await Promise.race([holding, done]);
  return async () => {
    release();
    await done;
  };
}

async function waitForRetentionLockWaiters(
  count: number,
  settled: () => boolean,
) {
  for (;;) {
    if (settled()) {
      throw new Error("A session finished instead of waiting on the lock.");
    }
    const rows = transactionRows(
      await getDb().execute(
        sql`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      ),
    );
    if (rows.some(({ waiting }) => Number(waiting) >= count)) return;
  }
}

function settle<T>(promise: Promise<T>) {
  const state = { settled: false };
  const outcome = promise.then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  void outcome.then(() => {
    state.settled = true;
  });
  return { outcome, settled: () => state.settled };
}

// oracle-change: new suite, skipped without PostgreSQL like Content's other Postgres integration files.
describe.skipIf(!POSTGRES_URL)(
  "Content Trash automatic deletion on PostgreSQL",
  () => {
    it("starts one automatic deletion when two runs race across UTC midnight", async () => {
      await insertTrashedPage("midnight-root", at(10));
      await recordSetting(new Date(START), at(60, -30 * MINUTE));
      const deferred: string[] = [];
      const releaseGate = await holdRetentionLock();

      const beforeMidnight = settle(run(at(60, -MINUTE), { deferred }));
      const afterMidnight = settle(run(at(60), { deferred }));
      await waitForRetentionLockWaiters(
        2,
        () => beforeMidnight.settled() || afterMidnight.settled(),
      );
      await releaseGate();
      const results = await Promise.all([
        beforeMidnight.outcome,
        afterMidnight.outcome,
      ]);

      expect(results.map(({ error }) => error)).toEqual([null, null]);
      expect(results.map(({ value }) => value?.outcome).sort()).toEqual([
        "in-progress",
        "started",
      ]);
      expect(await unfinishedOperationIds()).toEqual(deferred);
      const [operationId] = deferred;
      if (!operationId) throw new Error("automatic deletion was not started");
      await drain(operationId);
      expect(await pageExists("midnight-root")).toBe(false);
    });

    it("deletes nothing when a re-arm commits while its worker waits to delete", async () => {
      await insertTrashedPage("waiting-worker-root", at(70));
      await recordSetting(new Date(START), at(100, -30 * MINUTE));
      const deferred: string[] = [];
      await expect(run(at(100), { deferred })).resolves.toMatchObject({
        outcome: "started",
        units: 1,
      });
      const [operationId] = deferred;
      if (!operationId) throw new Error("automatic deletion was not started");
      const releaseGate = await holdRetentionLock();

      const rearm = settle(
        run(at(104), {
          idleRearmMs: retention.CONTENT_TRASH_RETENTION_IDLE_REARM_MS,
        }),
      );
      await waitForRetentionLockWaiters(1, rearm.settled);
      const worker = settle(workOnce(operationId));
      await waitForRetentionLockWaiters(
        2,
        () => rearm.settled() || worker.settled(),
      );
      await releaseGate();

      await expect(rearm.outcome).resolves.toEqual({
        value: {
          outcome: "rearmed",
          deletionsBeginAt: at(134).toISOString(),
          cancelledOperationIds: [operationId],
        },
        error: null,
      });
      const { value, error } = await worker.outcome;
      expect(value).toBeNull();
      expect(error?.constructor.name).toBe("ContentTrashPurgeLeaseLostError");
      expect(await pageExists("waiting-worker-root")).toBe(true);
      expect(await operation(operationId)).toMatchObject({
        status: "failed",
        lastError: purge.CONTENT_TRASH_RETENTION_REARM_REASON,
        deletedCount: 0,
        leaseToken: null,
      });
      expect(await itemOutcomes(operationId)).toEqual(["cancelled"]);
      await expect(workOnce(operationId)).resolves.toMatchObject({
        accepted: false,
      });
    });

    it("deletes nothing when a re-arm moved the start without cancelling a planned operation", async () => {
      await insertTrashedPage("old-generation-root", at(110));
      await recordSetting(at(104), at(150, -30 * MINUTE));
      const deferred: string[] = [];
      await expect(run(at(150), { deferred })).resolves.toMatchObject({
        outcome: "started",
        units: 2,
      });
      const [operationId] = deferred;
      if (!operationId) throw new Error("automatic deletion was not started");
      const movedStart = JSON.stringify({
        startedAt: at(150, 60 * MINUTE).toISOString(),
        lastSweepAt: at(150, 60 * MINUTE).toISOString(),
      });
      const releaseGate = await holdRetentionLock(async (tx) => {
        await tx.execute(
          sql`UPDATE public.settings SET value = ${movedStart}, updated_at = ${Date.now()} WHERE key = ${retention.CONTENT_TRASH_RETENTION_SETTING_KEY}`,
        );
      });

      const worker = settle(workOnce(operationId));
      await waitForRetentionLockWaiters(1, worker.settled);
      await releaseGate();

      await expect(worker.outcome).resolves.toEqual({
        value: { accepted: true, continued: false, status: "retryable" },
        error: null,
      });
      expect((await operation(operationId)).status).toBe("retryable");
      expect((await planFilters(operationId)).unitFailures).toBeUndefined();
      await expect(workOnce(operationId)).resolves.toEqual({
        accepted: true,
        continued: false,
        status: "failed",
      });
      expect(await pageExists("waiting-worker-root")).toBe(true);
      expect(await pageExists("old-generation-root")).toBe(true);
      expect(await operation(operationId)).toMatchObject({
        status: "failed",
        lastError: purge.CONTENT_TRASH_RETENTION_REARM_REASON,
        deletedCount: 0,
        leaseToken: null,
      });
      expect(await itemOutcomes(operationId)).toEqual([
        "cancelled",
        "cancelled",
      ]);
    });
  },
);
