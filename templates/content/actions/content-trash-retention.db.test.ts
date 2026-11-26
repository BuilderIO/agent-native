import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  } = {},
) {
  return retention.runContentTrashRetention({
    deadlineAt: Date.now() + 60_000,
    now,
    dispatch: options.dispatch ?? drain,
    maxUnits: options.maxUnits,
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
    await expect(
      retention.ensureContentTrashRetentionStart(at(5)),
    ).resolves.toBe(START);
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

  it("registers the daily sweep", () => {
    const unregister = sweep.registerContentTrashRetentionSweep();
    expect(
      hasRecurringSweepHandler(retention.CONTENT_TRASH_RETENTION_SWEEP_ID),
    ).toBe(true);
    unregister();
  });
});
