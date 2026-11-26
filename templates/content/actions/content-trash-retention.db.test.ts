import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import {
  hasRecurringSweepHandler,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-trash-retention-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "retention-owner@example.test";
const OTHER = "retention-other@example.test";
const ORG_ID = "retention-org";
const ORG_SPACE = "retention-org-space";
const PERSONAL_SPACE = "retention-personal-space";
const START = "2030-01-01T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let purge: typeof import("../server/lib/content-trash-purge.js");
let retention: typeof import("../server/lib/content-trash-retention.js");
let sweep: typeof import("../server/plugins/content-trash-retention.js");

const at = (days: number, offsetMs = 0) =>
  new Date(Date.parse(START) + days * DAY + offsetMs);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  purge = await import("../server/lib/content-trash-purge.js");
  retention = await import("../server/lib/content-trash-retention.js");
  sweep = await import("../server/plugins/content-trash-retention.js");
  await (await import("../server/plugins/db.js")).default(undefined as never);
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.contentSpaces)
    .values([
      {
        id: ORG_SPACE,
        name: "Retention workspace",
        kind: "organization",
        ownerEmail: OWNER,
        orgId: ORG_ID,
        filesDatabaseId: "retention-org-files",
        createdBy: OWNER,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PERSONAL_SPACE,
        name: "Retention personal",
        kind: "personal",
        ownerEmail: OTHER,
        orgId: null,
        filesDatabaseId: "retention-personal-files",
        createdBy: OTHER,
        createdAt: now,
        updatedAt: now,
      },
    ]);
}, 60_000);

afterAll(() => rmSync(TEST_DB_PATH, { force: true, recursive: true }));

async function insertPage(
  id: string,
  options: {
    trashedAt: Date | null;
    trashRootId?: string;
    parentId?: string | null;
    ownerEmail?: string;
    spaceId?: string;
    sourceMode?: string;
  },
) {
  const now = new Date().toISOString();
  const ownerEmail = options.ownerEmail ?? OWNER;
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      spaceId: options.spaceId ?? ORG_SPACE,
      ownerEmail,
      orgId: ownerEmail === OWNER ? ORG_ID : null,
      title: id,
      content: "",
      visibility: "private",
      parentId: options.parentId ?? null,
      trashedAt: options.trashedAt?.toISOString() ?? null,
      trashRootId: options.trashedAt ? (options.trashRootId ?? id) : null,
      trashedBy: options.trashedAt ? ownerEmail : null,
      sourceMode: options.sourceMode ?? null,
      createdAt: now,
      updatedAt: now,
    });
}

async function page(id: string) {
  const [row] = await getDb()
    .select({
      id: schema.documents.id,
      parentId: schema.documents.parentId,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row as
    | { id: string; parentId: string | null; trashedAt: string | null }
    | undefined;
}

async function operation(operationId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.contentTrashPurgeOperations)
    .where(eq(schema.contentTrashPurgeOperations.id, operationId));
  return row;
}

async function retentionOperations() {
  return getDb()
    .select()
    .from(schema.contentTrashPurgeOperations)
    .where(
      eq(
        schema.contentTrashPurgeOperations.actorEmail,
        purge.CONTENT_TRASH_RETENTION_ACTOR,
      ),
    );
}

async function planItems(operationId: string) {
  const { planId } = await operation(operationId);
  return getDb()
    .select()
    .from(schema.contentTrashPurgePlanItems)
    .where(eq(schema.contentTrashPurgePlanItems.planId, planId));
}

async function planFilters(operationId: string) {
  const { planId } = await operation(operationId);
  const [plan] = await getDb()
    .select({ filtersJson: schema.contentTrashPurgePlans.filtersJson })
    .from(schema.contentTrashPurgePlans)
    .where(eq(schema.contentTrashPurgePlans.id, planId));
  return purge.parseContentTrashRetentionPlanFilters(plan.filtersJson);
}

async function addToCollection(
  collectionDocumentId: string,
  memberDocumentId: string,
) {
  const databaseId = `${collectionDocumentId}-database`;
  await getDb().insert(schema.contentDatabases).values({
    id: databaseId,
    documentId: collectionDocumentId,
    ownerEmail: OWNER,
    spaceId: ORG_SPACE,
    title: collectionDocumentId,
  });
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({
      id: `${collectionDocumentId}-membership`,
      databaseId,
      documentId: memberDocumentId,
      ownerEmail: OWNER,
    });
}

const holdDispatch = (deferred: string[]) => async (operationId: string) => {
  deferred.push(operationId);
};

async function drain(operationId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await runWithRequestContext(
      { userEmail: purge.CONTENT_TRASH_RETENTION_ACTOR },
      () => purge.processContentTrashPurge(operationId),
    );
    const current = await operation(operationId);
    if (!["queued", "running", "retryable"].includes(current.status)) return;
  }
  const stuck = await operation(operationId);
  throw new Error(
    `Retention operation stayed ${stuck.status}: ${stuck.lastError ?? "no error"}`,
  );
}

function run(
  now: Date,
  options: {
    dispatch?: (operationId: string) => Promise<void>;
    maxUnits?: number;
    scanPageSize?: number;
    scanPages?: number;
    idleRearmMs?: number;
  } = {},
) {
  return retention.runContentTrashRetention({
    deadlineAt: Date.now() + 60_000,
    now,
    idleRearmMs: Number.POSITIVE_INFINITY,
    ...options,
    dispatch: options.dispatch ?? drain,
  });
}

describe("Content Trash automatic deletion", () => {
  it("records when it started on its first run and never moves that start", async () => {
    await expect(retention.readContentTrashRetention()).resolves.toEqual({
      retentionDays: 30,
      startedAt: null,
      deletionsBeginAt: null,
    });
    await insertPage("before-start", { trashedAt: at(-60) });
    await insertPage("before-start-child", {
      trashedAt: at(-60),
      trashRootId: "before-start",
      parentId: "before-start",
    });

    await expect(run(at(0))).resolves.toEqual({
      outcome: "waiting",
      deletionsBeginAt: at(30).toISOString(),
    });
    await expect(run(at(3))).resolves.toEqual({
      outcome: "waiting",
      deletionsBeginAt: at(30).toISOString(),
    });
    await expect(retention.readContentTrashRetention()).resolves.toEqual({
      retentionDays: 30,
      startedAt: START,
      deletionsBeginAt: at(30).toISOString(),
    });
  });

  it("deletes nothing before the start plus 30 days, even long-trashed Pages", async () => {
    await expect(run(at(29, 23 * HOUR))).resolves.toMatchObject({
      outcome: "waiting",
    });

    expect(await page("before-start")).toBeDefined();
    expect(await page("before-start-child")).toBeDefined();
    expect(await retentionOperations()).toEqual([]);
  });

  it("deletes each Trash root once its 30 days have passed, in every space", async () => {
    await insertPage("after-start", { trashedAt: at(1) });
    await insertPage("other-owner", {
      trashedAt: at(-10),
      ownerEmail: OTHER,
      spaceId: PERSONAL_SPACE,
    });

    const first = await run(at(30, HOUR));
    expect(first).toMatchObject({ outcome: "started", units: 2, documents: 3 });
    if (first.outcome !== "started") throw new Error("expected a run");
    expect(await page("before-start")).toBeUndefined();
    expect(await page("before-start-child")).toBeUndefined();
    expect(await page("other-owner")).toBeUndefined();
    expect(await page("after-start")).toBeDefined();
    expect(await operation(first.operationId)).toMatchObject({
      actorEmail: purge.CONTENT_TRASH_RETENTION_ACTOR,
      idempotencyKey: "retention:2030-01-31",
      status: "succeeded",
      deletedCount: 3,
      blockedCount: 0,
    });
    const [plan] = await getDb()
      .select()
      .from(schema.contentTrashPurgePlans)
      .where(
        eq(
          schema.contentTrashPurgePlans.id,
          (await operation(first.operationId)).planId,
        ),
      );
    expect(plan).toMatchObject({
      mode: purge.CONTENT_TRASH_RETENTION_PLAN_MODE,
      state: "confirmed",
    });
    expect(
      (await planItems(first.operationId)).map((item) => item.outcome),
    ).toEqual(["deleted", "deleted", "deleted"]);

    await expect(run(at(30, 2 * HOUR))).resolves.toEqual({
      outcome: "done-today",
      operationId: first.operationId,
    });
    expect(await page("after-start")).toBeDefined();

    await expect(run(at(31, 2 * HOUR))).resolves.toMatchObject({
      outcome: "started",
      units: 1,
    });
    expect(await page("after-start")).toBeUndefined();
  });

  it("keeps a Trash root on its own date, whatever its neighbours' dates", async () => {
    await insertPage("old-parent", { trashedAt: at(5) });
    await insertPage("young-sub", {
      trashedAt: at(20),
      parentId: "old-parent",
    });
    await insertPage("young-parent", { trashedAt: at(25) });
    await insertPage("old-sub", {
      trashedAt: at(3),
      parentId: "young-parent",
    });

    const first = await run(at(40, HOUR));
    expect(first).toMatchObject({ outcome: "started", units: 2, documents: 2 });
    expect(await page("old-parent")).toBeUndefined();
    expect(await page("old-sub")).toBeUndefined();
    expect(await page("young-sub")).toEqual({
      id: "young-sub",
      parentId: null,
      trashedAt: at(20).toISOString(),
    });
    expect(await page("young-parent")).toMatchObject({
      trashedAt: at(25).toISOString(),
    });

    await expect(run(at(51, HOUR))).resolves.toMatchObject({
      outcome: "started",
      units: 1,
    });
    expect(await page("young-sub")).toBeUndefined();
    expect(await page("young-parent")).toMatchObject({
      trashedAt: at(25).toISOString(),
    });
    await expect(run(at(56, HOUR))).resolves.toMatchObject({
      outcome: "started",
      units: 1,
    });
    expect(await page("young-parent")).toBeUndefined();
  });

  it("starts one run a day when two runners race, and deletes each Page once", async () => {
    await insertPage("race-one", { trashedAt: at(20) });
    await insertPage("race-two", { trashedAt: at(21) });

    const results = await Promise.all([run(at(60, HOUR)), run(at(60, HOUR))]);

    expect(results.filter((result) => result.outcome === "started")).toEqual([
      expect.objectContaining({ units: 2, documents: 2 }),
    ]);
    expect(
      results.every((result) =>
        ["started", "claimed-elsewhere", "in-progress", "done-today"].includes(
          result.outcome,
        ),
      ),
    ).toBe(true);
    const today = (await retentionOperations()).filter(
      (row: { idempotencyKey: string }) =>
        row.idempotencyKey === "retention:2030-03-02",
    );
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ status: "succeeded", deletedCount: 2 });
    expect(await page("race-one")).toBeUndefined();
    expect(await page("race-two")).toBeUndefined();
  });

  it("deletes at most its cap in one run and continues on the next", async () => {
    await insertPage("cap-one", { trashedAt: at(30) });
    await insertPage("cap-two", { trashedAt: at(31) });
    await insertPage("cap-three", { trashedAt: at(32) });

    await expect(run(at(70, HOUR), { maxUnits: 2 })).resolves.toMatchObject({
      outcome: "started",
      units: 2,
    });
    expect(await page("cap-one")).toBeUndefined();
    expect(await page("cap-two")).toBeUndefined();
    expect(await page("cap-three")).toBeDefined();

    await expect(run(at(71, HOUR), { maxUnits: 2 })).resolves.toMatchObject({
      outcome: "started",
      units: 1,
    });
    expect(await page("cap-three")).toBeUndefined();
  });

  it("keeps a Page restored before automatic deletion reaches it", async () => {
    await insertPage("restored-early", { trashedAt: at(40) });
    await insertPage("restored-late", { trashedAt: at(41) });
    await insertPage("deleted-alongside", { trashedAt: at(42) });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: null, trashRootId: null, trashedBy: null })
      .where(eq(schema.documents.id, "restored-early"));

    const deferred: string[] = [];
    const started = await run(at(80, HOUR), {
      dispatch: async (operationId) => {
        deferred.push(operationId);
      },
    });
    expect(started).toMatchObject({ outcome: "started", units: 2 });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: null, trashRootId: null, trashedBy: null })
      .where(eq(schema.documents.id, "restored-late"));
    expect(deferred).toHaveLength(1);
    const [operationId] = deferred;
    if (!operationId) throw new Error("automatic deletion was not dispatched");
    await drain(operationId);

    expect(await page("restored-early")).toMatchObject({ trashedAt: null });
    expect(await page("restored-late")).toMatchObject({ trashedAt: null });
    expect(await page("deleted-alongside")).toBeUndefined();
    expect(await operation(operationId)).toMatchObject({
      status: "partially_completed",
      deletedCount: 1,
      blockedCount: 1,
    });
    const items = await planItems(operationId);
    expect(
      items.find(
        (item: { documentId: string }) => item.documentId === "restored-late",
      ),
    ).toMatchObject({
      outcome: "blocked",
      outcomeDetail: "No longer in Trash when automatic deletion ran",
    });
  });

  it("resumes a run that stopped part-way, and leaves one that is still working", async () => {
    await insertPage("resume-me", { trashedAt: at(50) });
    const deferred: string[] = [];
    const started = await run(at(90, HOUR), {
      dispatch: async (operationId) => {
        deferred.push(operationId);
      },
    });
    expect(started).toMatchObject({ outcome: "started" });
    const [operationId] = deferred;
    if (!operationId) throw new Error("automatic deletion was not dispatched");
    const future = new Date(Date.now() + HOUR).toISOString();
    await getDb()
      .update(schema.contentTrashPurgeOperations)
      .set({ status: "running", leaseToken: "live", leaseExpiresAt: future })
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));

    await expect(
      run(at(90, 2 * HOUR), {
        dispatch: async (id) => {
          deferred.push(id);
        },
      }),
    ).resolves.toEqual({ outcome: "in-progress", operationId, resumed: false });
    expect(deferred).toHaveLength(1);

    const past = new Date(Date.now() - HOUR).toISOString();
    await getDb()
      .update(schema.contentTrashPurgeOperations)
      .set({ leaseExpiresAt: past, updatedAt: past })
      .where(
        and(
          eq(schema.contentTrashPurgeOperations.id, operationId),
          eq(schema.contentTrashPurgeOperations.status, "running"),
        ),
      );
    await expect(run(at(91, HOUR))).resolves.toEqual({
      outcome: "in-progress",
      operationId,
      resumed: true,
    });
    expect(await page("resume-me")).toBeUndefined();
    expect(await operation(operationId)).toMatchObject({
      status: "succeeded",
      deletedCount: 1,
    });
  });

  it("keeps an old collection whose younger member is protected, as Empty Trash does", async () => {
    await insertPage("guarded-collection", { trashedAt: at(60) });
    await insertPage("guarded-member", {
      trashedAt: at(75),
      sourceMode: "linked",
    });
    await insertPage("unguarded-root", { trashedAt: at(61) });
    await addToCollection("guarded-collection", "guarded-member");

    await expect(run(at(100, HOUR))).resolves.toMatchObject({
      outcome: "started",
      units: 1,
      documents: 1,
    });
    expect(await page("unguarded-root")).toBeUndefined();
    expect(await page("guarded-collection")).toBeDefined();
    expect(await page("guarded-member")).toBeDefined();

    await expect(run(at(106, HOUR))).resolves.toMatchObject({
      outcome: "done-today",
    });
    expect(await page("guarded-collection")).toBeDefined();
    expect(await page("guarded-member")).toBeDefined();
  });

  it("records a Trash root that keeps failing and still deletes the roots behind it", async () => {
    await insertPage("fail-a-poison", { trashedAt: at(70) });
    await insertPage("fail-b-behind", { trashedAt: at(71) });
    const exec = getDbExec();
    await exec.execute(`
      CREATE FUNCTION retention_fail_delete() RETURNS trigger
      LANGUAGE plpgsql AS $failure$
      BEGIN
        IF OLD.id = 'fail-a-poison' THEN
          RAISE EXCEPTION 'injected delete failure';
        END IF;
        RETURN OLD;
      END;
      $failure$;
    `);
    await exec.execute(`
      CREATE TRIGGER retention_fail_delete
      BEFORE DELETE ON documents
      FOR EACH ROW EXECUTE FUNCTION retention_fail_delete();
    `);
    try {
      const first = await run(at(110, HOUR));
      expect(first).toMatchObject({ outcome: "started", units: 2 });
      if (first.outcome !== "started") throw new Error("expected a run");
      expect(await page("fail-b-behind")).toBeUndefined();
      expect(await page("fail-a-poison")).toBeDefined();
      expect(await operation(first.operationId)).toMatchObject({
        status: "partially_completed",
        deletedCount: 1,
      });
      const failed = (await planItems(first.operationId)).find(
        (item: { documentId: string }) => item.documentId === "fail-a-poison",
      );
      expect(failed?.outcome).toBe("failed");
      expect(failed?.outcomeDetail).toContain(
        "Automatic deletion of Trash root fail-a-poison failed",
      );
      expect(failed?.outcomeDetail).toContain(
        `(attempt ${purge.CONTENT_TRASH_RETENTION_UNIT_ATTEMPTS} of ${purge.CONTENT_TRASH_RETENTION_UNIT_ATTEMPTS})`,
      );
      expect((await planFilters(first.operationId)).unitFailures).toEqual({
        "fail-a-poison": purge.CONTENT_TRASH_RETENTION_UNIT_ATTEMPTS,
      });

      const next = await run(at(111, HOUR));
      expect(next).toMatchObject({ outcome: "started", units: 1 });
      if (next.outcome !== "started") throw new Error("expected a run");
      expect(await operation(next.operationId)).toMatchObject({
        status: "partially_completed",
        deletedCount: 0,
      });
    } finally {
      await exec.execute("DROP TRIGGER retention_fail_delete ON documents");
      await exec.execute("DROP FUNCTION retention_fail_delete()");
    }

    await expect(run(at(112, HOUR))).resolves.toMatchObject({
      outcome: "started",
      units: 1,
    });
    expect(await page("fail-a-poison")).toBeUndefined();
  });

  it("reaches an eligible root behind many it cannot delete", async () => {
    for (const index of [1, 2, 3]) {
      await insertPage(`starve-source-${index}`, {
        trashedAt: at(79, index),
        sourceMode: "linked",
      });
      await insertPage(`starve-member-${index}`, {
        trashedAt: at(79, index),
        sourceMode: "linked",
      });
      await insertPage(`starve-collection-${index}`, {
        trashedAt: at(80, index),
      });
      await addToCollection(
        `starve-collection-${index}`,
        `starve-member-${index}`,
      );
    }
    await insertPage("starve-eligible", { trashedAt: at(85) });
    const window = { scanPageSize: 2, scanPages: 1 };
    const cursor = (id: string, trashedAt: Date) => ({
      trashedAt: trashedAt.toISOString(),
      id,
    });

    const first = await run(at(120, HOUR), window);
    expect(first).toMatchObject({ outcome: "done-today" });
    if (first.outcome !== "done-today") throw new Error("expected a plan");
    expect((await planFilters(first.operationId)).scan).toEqual({
      startedAfter: null,
      stoppedAt: cursor("starve-collection-1", at(80, 1)),
      exhausted: false,
    });

    const second = await run(at(121, HOUR), window);
    expect(second).toMatchObject({ outcome: "done-today" });
    if (second.outcome !== "done-today") throw new Error("expected a plan");
    expect((await planFilters(second.operationId)).scan).toEqual({
      startedAfter: cursor("starve-collection-1", at(80, 1)),
      stoppedAt: cursor("starve-collection-3", at(80, 3)),
      exhausted: false,
    });
    expect(await page("starve-eligible")).toBeDefined();

    const third = await run(at(122, HOUR), window);
    expect(third).toMatchObject({ outcome: "started", units: 1 });
    if (third.outcome !== "started") throw new Error("expected a run");
    expect(await page("starve-eligible")).toBeUndefined();
    expect((await planFilters(third.operationId)).scan).toEqual({
      startedAfter: cursor("starve-collection-3", at(80, 3)),
      stoppedAt: cursor("starve-eligible", at(85)),
      exhausted: true,
    });
  });

  it("keeps one automatic deletion unfinished when runs straddle UTC midnight", async () => {
    await insertPage("midnight-root", { trashedAt: at(90) });
    const deferred: string[] = [];

    const results = await Promise.all([
      run(at(131, -60_000), { dispatch: holdDispatch(deferred) }),
      run(at(131), { dispatch: holdDispatch(deferred) }),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "in-progress",
      "started",
    ]);
    const unfinished = (await retentionOperations()).filter(
      (row: { status: string }) =>
        ["queued", "running", "retryable"].includes(row.status),
    );
    expect(unfinished.map((row: { id: string }) => row.id)).toEqual(deferred);
    const [operationId] = deferred;
    if (!operationId) throw new Error("automatic deletion was not dispatched");
    await drain(operationId);
    expect(await page("midnight-root")).toBeUndefined();
  });

  it("starts the 30 days again after automatic deletion stopped running for over 3 days", async () => {
    await insertPage("rearm-root", { trashedAt: at(100) });
    const deferred: string[] = [];
    await expect(
      run(at(140, HOUR), { dispatch: holdDispatch(deferred) }),
    ).resolves.toMatchObject({ outcome: "started", units: 1 });
    const [staleId] = deferred;
    if (!staleId) throw new Error("automatic deletion was not dispatched");
    const idleRearmMs = retention.CONTENT_TRASH_RETENTION_IDLE_REARM_MS;

    await expect(run(at(144, 2 * HOUR), { idleRearmMs })).resolves.toEqual({
      outcome: "rearmed",
      deletionsBeginAt: at(174, 2 * HOUR).toISOString(),
      cancelledOperationIds: [staleId],
    });
    expect(await operation(staleId)).toMatchObject({
      status: "failed",
      leaseToken: null,
    });
    expect(
      (await planItems(staleId)).map(
        (item: { outcome: string }) => item.outcome,
      ),
    ).toEqual(["cancelled"]);
    await expect(retention.readContentTrashRetention()).resolves.toEqual({
      retentionDays: 30,
      startedAt: at(144, 2 * HOUR).toISOString(),
      deletionsBeginAt: at(174, 2 * HOUR).toISOString(),
    });

    await expect(run(at(146, 2 * HOUR), { idleRearmMs })).resolves.toEqual({
      outcome: "waiting",
      deletionsBeginAt: at(174, 2 * HOUR).toISOString(),
    });
    await expect(run(at(174, HOUR))).resolves.toMatchObject({
      outcome: "waiting",
    });
    expect(await page("rearm-root")).toBeDefined();
    await expect(run(at(174, 3 * HOUR))).resolves.toMatchObject({
      outcome: "started",
      units: 1,
    });
    expect(await page("rearm-root")).toBeUndefined();
  });

  it("registers the daily sweep", () => {
    const unregister = sweep.registerContentTrashRetentionSweep();
    expect(
      hasRecurringSweepHandler(retention.CONTENT_TRASH_RETENTION_SWEEP_ID),
    ).toBe(true);
    unregister();
  });
});
