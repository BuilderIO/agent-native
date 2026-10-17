import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-trash-purge-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "purge-owner@example.test";
const SPACE_ID = "purge-space";
const ORG_ID = "purge-org";
const ORG_SPACE_ID = "purge-org-space";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let planPurge: typeof import("./plan-content-trash-purge.js").default;
let processPurge: typeof import("../server/lib/content-trash-purge.js").processContentTrashPurge;
let getPlan: typeof import("./get-content-trash-purge-plan.js").default;
let getOperation: typeof import("./get-content-trash-operation.js").default;
let executePurge: typeof import("./execute-content-trash-purge.js").default;
let permanentlyDeleteDocument: typeof import("./permanently-delete-document.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);
const asUser = <T>(email: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: email }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  planPurge = (await import("./plan-content-trash-purge.js")).default;
  processPurge = (await import("../server/lib/content-trash-purge.js"))
    .processContentTrashPurge;
  getPlan = (await import("./get-content-trash-purge-plan.js")).default;
  getOperation = (await import("./get-content-trash-operation.js")).default;
  executePurge = (await import("./execute-content-trash-purge.js")).default;
  permanentlyDeleteDocument = (await import("./permanently-delete-document.js"))
    .default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
  const now = new Date().toISOString();
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
    args: [ORG_ID, "Purge Org", OWNER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
    args: ["purge-org-owner", ORG_ID, OWNER, "owner", Date.now()],
  });
  await getDb().insert(schema.contentSpaces).values({
    id: SPACE_ID,
    name: "Purge",
    kind: "personal",
    ownerEmail: OWNER,
    orgId: null,
    filesDatabaseId: "purge-files",
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentSpaces).values({
    id: ORG_SPACE_ID,
    name: "Purge Org",
    kind: "organization",
    ownerEmail: OWNER,
    orgId: ORG_ID,
    filesDatabaseId: "purge-org-files",
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(() => rmSync(TEST_DB_PATH, { force: true, recursive: true }));

async function insertTrashed(
  id: string,
  rootId = id,
  extra: Record<string, unknown> = {},
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      spaceId: SPACE_ID,
      ownerEmail: OWNER,
      title: id,
      content: "",
      visibility: "private",
      trashedAt: now,
      trashRootId: rootId,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
}

describe("Content Trash purge", () => {
  it("freezes matching candidates beyond two list pages without truncation", async () => {
    for (let index = 0; index < 105; index += 1) {
      await insertTrashed(`many-${index}`);
    }
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "matching",
        filters: { query: "many-" },
      }),
    );
    expect(plan.eligibleCount).toBe(105);
    expect(plan.affectedPreview).toHaveLength(50);
  });

  it("matches offset date bounds as UTC instants", async () => {
    await insertTrashed("offset-bound", "offset-bound", {
      trashedAt: "2026-09-14T01:00:00.000Z",
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "matching",
        filters: {
          deletedFrom: "2026-09-13T20:30:00.000-04:00",
          deletedTo: "2026-09-13T21:30:00.000-04:00",
        },
      }),
    );
    expect(plan.affectedPreview.map((item) => item.documentId)).toContain(
      "offset-bound",
    );
  });

  it("deduplicates overlapping root/child selections and excludes later Trash", async () => {
    await insertTrashed("overlap-root");
    await insertTrashed("overlap-child", "overlap-root", {
      parentId: "overlap-root",
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["overlap-root", "overlap-child", "overlap-root"],
      }),
    );
    await insertTrashed("after-plan");
    const items = await getDb()
      .select()
      .from(schema.contentTrashPurgePlanItems)
      .where(eq(schema.contentTrashPurgePlanItems.planId, plan.planId));
    expect(items.map((item: any) => item.documentId).sort()).toEqual([
      "overlap-child",
      "overlap-root",
    ]);
  });

  it("freezes a selected nested Page and its descendants without its root or siblings", async () => {
    await insertTrashed("selected-nested-root");
    await insertTrashed("selected-nested", "selected-nested-root", {
      parentId: "selected-nested-root",
    });
    await insertTrashed("selected-nested-child", "selected-nested-root", {
      parentId: "selected-nested",
    });
    await insertTrashed("selected-nested-sibling", "selected-nested-root", {
      parentId: "selected-nested-root",
    });
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["selected-nested"] }),
    );
    const items = await getDb()
      .select({ documentId: schema.contentTrashPurgePlanItems.documentId })
      .from(schema.contentTrashPurgePlanItems)
      .where(eq(schema.contentTrashPurgePlanItems.planId, plan.planId));
    expect(items.map((item: any) => item.documentId).sort()).toEqual([
      "selected-nested",
      "selected-nested-child",
    ]);
  });

  it("freezes a matching nested Page and its descendants without its root or siblings", async () => {
    await insertTrashed("matching-nested-root");
    await insertTrashed("matching-nested-target", "matching-nested-root", {
      parentId: "matching-nested-root",
    });
    await insertTrashed("matching-nested-child", "matching-nested-root", {
      parentId: "matching-nested-target",
    });
    await insertTrashed("matching-nested-sibling", "matching-nested-root", {
      parentId: "matching-nested-root",
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "matching",
        filters: { query: "matching-nested-target" },
      }),
    );
    const items = await getDb()
      .select({ documentId: schema.contentTrashPurgePlanItems.documentId })
      .from(schema.contentTrashPurgePlanItems)
      .where(eq(schema.contentTrashPurgePlanItems.planId, plan.planId));
    expect(items.map((item: any) => item.documentId).sort()).toEqual([
      "matching-nested-child",
      "matching-nested-target",
    ]);
  });

  it("conflicts instead of deleting a descendant added to the frozen group", async () => {
    await insertTrashed("frozen-root");
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["frozen-root"] }),
    );
    await insertTrashed("late-group-child", "frozen-root", {
      parentId: "frozen-root",
    });
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "late-group-child",
      status: "queued",
      eligibleCount: plan.eligibleCount,
    });
    await asOwner(() => processPurge(operationId));
    const survivors = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.trashRootId, "frozen-root"));
    expect(survivors.map((item: any) => item.id).sort()).toEqual([
      "frozen-root",
      "late-group-child",
    ]);
  });

  it("conflicts when collection membership changes after planning", async () => {
    await insertTrashed("membership-root");
    await getDb().insert(schema.contentDatabases).values({
      id: "membership-database",
      documentId: "membership-root",
      ownerEmail: OWNER,
      spaceId: SPACE_ID,
      title: "Membership database",
    });
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["membership-root"] }),
    );
    await insertTrashed("membership-late-row");
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "membership-late-edge",
      databaseId: "membership-database",
      documentId: "membership-late-row",
      ownerEmail: OWNER,
    });
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "membership-changed",
      status: "queued",
      eligibleCount: plan.eligibleCount,
    });
    await asOwner(() => processPurge(operationId));
    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(operation.status).toBe("conflicted");
  });

  it("conflicts when source protection changes after planning", async () => {
    await insertTrashed("source-transition");
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["source-transition"] }),
    );
    await getDb()
      .update(schema.documents)
      .set({ sourceMode: "linked" })
      .where(eq(schema.documents.id, "source-transition"));
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "source-transition",
      status: "queued",
      eligibleCount: plan.eligibleCount,
    });
    await asOwner(() => processPurge(operationId));
    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(operation.status).toBe("conflicted");
  });

  it("conflicts when an owned database becomes system-protected", async () => {
    await insertTrashed("system-transition");
    await getDb().insert(schema.contentDatabases).values({
      id: "system-transition-database",
      documentId: "system-transition",
      ownerEmail: OWNER,
      spaceId: SPACE_ID,
      title: "Transition database",
    });
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["system-transition"] }),
    );
    await getDb()
      .update(schema.contentDatabases)
      .set({ systemRole: "files" })
      .where(eq(schema.contentDatabases.id, "system-transition-database"));
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "system-transition",
      status: "queued",
      eligibleCount: plan.eligibleCount,
    });
    await asOwner(() => processPurge(operationId));
    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(operation.status).toBe("conflicted");
  });

  it("paginates every reviewed plan item and operation outcome", async () => {
    const ids = Array.from({ length: 3 }, (_, index) => `paged-${index}`);
    for (const id of ids) await insertTrashed(id);
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ids }),
    );
    const firstPlanPage = await asOwner(() =>
      getPlan.run({ planId: plan.planId, limit: 2 }),
    );
    const secondPlanPage = await asOwner(() =>
      getPlan.run({
        planId: plan.planId,
        cursor: firstPlanPage.nextCursor!,
        limit: 2,
      }),
    );
    expect(firstPlanPage.items).toHaveLength(2);
    expect(secondPlanPage.items).toHaveLength(1);

    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "paged-outcomes",
      status: "queued",
      eligibleCount: plan.eligibleCount,
    });
    const firstOutcomePage = await asOwner(() =>
      getOperation.run({ operationId, limit: 2 }),
    );
    const secondOutcomePage = await asOwner(() =>
      getOperation.run({
        operationId,
        cursor: firstOutcomePage.nextCursor!,
        limit: 2,
      }),
    );
    expect(firstOutcomePage.outcomes).toHaveLength(2);
    expect(secondOutcomePage.outcomes).toHaveLength(1);
  });

  it("discloses a source blocker and blocks its whole dependency unit", async () => {
    await insertTrashed("blocked-root");
    await insertTrashed("blocked-child", "blocked-root", {
      parentId: "blocked-root",
      sourceMode: "linked",
    });
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["blocked-root"] }),
    );
    expect(plan.eligibleCount).toBe(0);
    expect(plan.blockedCount).toBe(2);
    expect(plan.affectedPreview.every((item) => !item.eligible)).toBe(true);
  });

  it("keeps an independent eligible unit explicit beside blocked remains", async () => {
    await insertTrashed("partial-eligible");
    await insertTrashed("partial-blocked", "partial-blocked", {
      sourceMode: "linked",
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["partial-eligible", "partial-blocked"],
      }),
    );
    expect(plan.eligibleCount).toBe(1);
    expect(plan.blockedCount).toBe(1);
    expect(plan.affectedPreview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "partial-eligible",
          eligible: true,
        }),
        expect.objectContaining({
          documentId: "partial-blocked",
          eligible: false,
        }),
      ]),
    );
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "partial-execution",
      status: "queued",
      eligibleCount: plan.eligibleCount,
      blockedCount: plan.blockedCount,
    });
    await asOwner(() => processPurge(operationId));
    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    const [eligible, blocked] = await Promise.all([
      getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, "partial-eligible")),
      getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, "partial-blocked")),
    ]);
    expect(operation.status).toBe("partially_completed");
    expect(operation.deletedCount).toBe(1);
    expect(eligible).toHaveLength(0);
    expect(blocked).toHaveLength(1);
  });

  it("propagates a blocked independent collection member to its owner unit", async () => {
    await insertTrashed("collection-owner");
    await insertTrashed("collection-member", "collection-member", {
      sourceMode: "linked",
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "dependency-database",
      documentId: "collection-owner",
      ownerEmail: OWNER,
      spaceId: SPACE_ID,
      title: "Dependency database",
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "dependency-membership",
      databaseId: "dependency-database",
      documentId: "collection-member",
      ownerEmail: OWNER,
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["collection-owner", "collection-member"],
      }),
    );
    expect(plan.eligibleCount).toBe(0);
    expect(plan.blockedCount).toBe(2);
    expect(
      plan.affectedPreview.find(
        (item) => item.documentId === "collection-owner",
      )?.blocker,
    ).toContain("blocked descendant");
  });

  it("fails a multi-unit plan read when access to any represented unit changes", async () => {
    await insertTrashed("revoked-readable");
    await insertTrashed("revoked-hidden");
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["revoked-readable", "revoked-hidden"],
      }),
    );
    await getDb()
      .delete(schema.documents)
      .where(eq(schema.documents.id, "revoked-hidden"));

    await expect(
      asOwner(() => getPlan.run({ planId: plan.planId, limit: 100 })),
    ).rejects.toThrow();

    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "revoked-completed-operation",
      status: "partially_completed",
      eligibleCount: 2,
      deletedCount: 1,
      conflictedCount: 1,
      completedAt: new Date().toISOString(),
    });
    await expect(
      asOwner(() => getOperation.run({ operationId, limit: 100 })),
    ).resolves.toEqual(expect.objectContaining({ operationId }));
    await expect(
      asUser("unrelated@example.test", () =>
        getOperation.run({ operationId, limit: 100 }),
      ),
    ).rejects.toThrow();
  });

  it("discloses a surviving child's reparenting without labeling a deleted descendant", async () => {
    await insertTrashed("effect-root");
    await insertTrashed("effect-child", "effect-root", {
      parentId: "effect-root",
    });
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "effect-survivor",
      spaceId: SPACE_ID,
      ownerEmail: OWNER,
      title: "Surviving child",
      content: "",
      visibility: "private",
      parentId: "effect-root",
      createdAt: now,
      updatedAt: now,
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["effect-root", "effect-child"],
      }),
    );
    expect(
      plan.affectedPreview.find((item) => item.documentId === "effect-child")
        ?.survivorEffect,
    ).toBeNull();
    expect(
      plan.affectedPreview.find((item) => item.documentId === "effect-root"),
    ).toEqual(
      expect.objectContaining({
        title: "effect-root",
        survivorEffect: "“Surviving child” will move to the top level",
      }),
    );
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "effect-survivor-mutation",
      status: "queued",
      eligibleCount: plan.eligibleCount,
    });
    await asOwner(() => processPurge(operationId));
    const [survivor] = await getDb()
      .select({ parentId: schema.documents.parentId })
      .from(schema.documents)
      .where(eq(schema.documents.id, "effect-survivor"));
    expect(survivor?.parentId).toBeNull();
  });

  it("discloses a surviving trashed Page losing collection membership", async () => {
    await insertTrashed("effect-database");
    await insertTrashed("effect-member");
    await getDb().insert(schema.contentDatabases).values({
      id: "effect-database-record",
      documentId: "effect-database",
      ownerEmail: OWNER,
      spaceId: SPACE_ID,
      title: "Effect database",
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "effect-membership",
      databaseId: "effect-database-record",
      documentId: "effect-member",
      ownerEmail: OWNER,
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["effect-database"],
      }),
    );
    expect(plan.affectedPreview).toEqual([
      expect.objectContaining({
        title: "effect-database",
        survivorEffect: "“effect-member” will be removed from this collection",
      }),
    ]);
  });

  it("conflicts when a disclosed survivor relationship changes", async () => {
    await insertTrashed("changed-effect-root");
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "changed-effect-survivor",
      spaceId: SPACE_ID,
      ownerEmail: OWNER,
      title: "Original survivor title",
      content: "",
      visibility: "private",
      parentId: "changed-effect-root",
      createdAt: now,
      updatedAt: now,
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["changed-effect-root"],
      }),
    );
    await getDb()
      .update(schema.documents)
      .set({ title: "Changed survivor title" })
      .where(eq(schema.documents.id, "changed-effect-survivor"));
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "changed-survivor-effect",
      status: "queued",
      eligibleCount: 1,
    });
    await asOwner(() => processPurge(operationId));
    const [operation] = await getDb()
      .select({ status: schema.contentTrashPurgeOperations.status })
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(operation?.status).toBe("conflicted");
  });

  it("rejects direct deletion when a disclosed survivor relationship changes", async () => {
    await insertTrashed("direct-changed-effect-root");
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "direct-changed-effect-survivor",
      spaceId: SPACE_ID,
      ownerEmail: OWNER,
      title: "Original direct survivor title",
      content: "",
      visibility: "private",
      parentId: "direct-changed-effect-root",
      createdAt: now,
      updatedAt: now,
    });
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["direct-changed-effect-root"],
      }),
    );
    await getDb()
      .update(schema.documents)
      .set({ title: "Changed direct survivor title" })
      .where(eq(schema.documents.id, "direct-changed-effect-survivor"));

    await expect(
      asOwner(() =>
        permanentlyDeleteDocument.run({
          id: "direct-changed-effect-root",
          planId: plan.planId,
          scopeToken: plan.scopeToken,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "scope_changed", statusCode: 409 });

    const [root] = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.id, "direct-changed-effect-root"));
    expect(root?.id).toBe("direct-changed-effect-root");
  });

  it("persists the plan organization when the active organization differs or is absent", async () => {
    for (const [id, orgId] of [
      ["execute-mismatched-org", "another-org"],
      ["execute-no-active-org", undefined],
    ] as const) {
      await insertTrashed(id, id, { spaceId: ORG_SPACE_ID, orgId: ORG_ID });
      const plan = await runWithRequestContext(
        { userEmail: OWNER, orgId },
        () => planPurge.run({ mode: "selection", documentIds: [id] }),
      );
      const [savedPlan] = await getDb()
        .select({ orgId: schema.contentTrashPurgePlans.orgId })
        .from(schema.contentTrashPurgePlans)
        .where(eq(schema.contentTrashPurgePlans.id, plan.planId));
      expect(savedPlan?.orgId).toBe(ORG_ID);
      await runWithRequestContext({ userEmail: OWNER, orgId }, () =>
        executePurge.run({
          planId: plan.planId,
          scopeToken: plan.scopeToken,
          idempotencyKey: id,
        }),
      ).catch(() => undefined);
      const [operation] = await getDb()
        .select({ orgId: schema.contentTrashPurgeOperations.orgId })
        .from(schema.contentTrashPurgeOperations)
        .where(eq(schema.contentTrashPurgeOperations.planId, plan.planId));
      expect(operation?.orgId).toBe(ORG_ID);
    }
  });

  it("rejects a plan spanning personal and organization provenance", async () => {
    await insertTrashed("mixed-personal");
    await insertTrashed("mixed-organization", "mixed-organization", {
      spaceId: ORG_SPACE_ID,
      orgId: ORG_ID,
    });
    await expect(
      asOwner(() =>
        planPurge.run({
          mode: "selection",
          documentIds: ["mixed-personal", "mixed-organization"],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_scope" });
  });

  it("revalidates plan authority before returning an idempotent operation", async () => {
    await insertTrashed("revoked-org-retry", "revoked-org-retry", {
      spaceId: ORG_SPACE_ID,
      orgId: ORG_ID,
    });
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["revoked-org-retry"] }),
    );
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: crypto.randomUUID(),
      planId: plan.planId,
      actorEmail: OWNER,
      orgId: ORG_ID,
      idempotencyKey: "revoked-org-retry",
      status: "succeeded",
      eligibleCount: 1,
    });
    await getDbExec().execute({
      sql: "DELETE FROM org_members WHERE id = $1",
      args: ["purge-org-owner"],
    });
    await expect(
      asOwner(() =>
        executePurge.run({
          planId: plan.planId,
          scopeToken: plan.scopeToken,
          idempotencyKey: "revoked-org-retry",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_scope", statusCode: 404 });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: ["purge-org-owner", ORG_ID, OWNER, "owner", Date.now()],
    });
  });

  it("blocks an inaccessible child relationship without disclosing or mutating it", async () => {
    await insertTrashed("cross-owner-parent");
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "cross-owner-secret-child",
      spaceId: "other-space",
      ownerEmail: "other-owner@example.test",
      title: "Secret survivor title",
      content: "",
      visibility: "private",
      parentId: "cross-owner-parent",
      createdAt: now,
      updatedAt: now,
    });
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["cross-owner-parent"] }),
    );
    expect(plan.eligibleCount).toBe(0);
    expect(JSON.stringify(plan)).not.toContain("Secret survivor title");
    const [child] = await getDb()
      .select({ parentId: schema.documents.parentId })
      .from(schema.documents)
      .where(eq(schema.documents.id, "cross-owner-secret-child"));
    expect(child?.parentId).toBe("cross-owner-parent");
  });

  it("denies a completed shared receipt after initiating membership is revoked", async () => {
    await insertTrashed("revoked-org-receipt", "revoked-org-receipt", {
      spaceId: ORG_SPACE_ID,
      orgId: ORG_ID,
    });
    const plan = await runWithRequestContext(
      { userEmail: OWNER, orgId: ORG_ID },
      () =>
        planPurge.run({
          mode: "selection",
          documentIds: ["revoked-org-receipt"],
        }),
    );
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      orgId: ORG_ID,
      idempotencyKey: "revoked-org-receipt",
      status: "succeeded",
      eligibleCount: 1,
      deletedCount: 1,
      completedAt: new Date().toISOString(),
    });
    await getDbExec().execute({
      sql: "DELETE FROM org_members WHERE id = $1",
      args: ["purge-org-owner"],
    });
    await expect(
      asOwner(() => getOperation.run({ operationId, limit: 100 })),
    ).rejects.toThrow();
  });

  it("reclaims an expired lease and records a changed generation as conflict", async () => {
    await insertTrashed("lease-root");
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["lease-root"] }),
    );
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "expired-lease",
      status: "running",
      eligibleCount: 1,
      leaseToken: "expired",
      leaseExpiresAt: "2020-01-01T00:00:00.000Z",
    });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: "2026-09-14T12:00:00.000Z" })
      .where(eq(schema.documents.id, "lease-root"));
    await asOwner(() => processPurge(operationId));
    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(operation.status).toBe("conflicted");
    expect(operation.conflictedCount).toBe(1);
  });

  it("allows only one overlapping lease holder to delete and count a unit", async () => {
    await insertTrashed("overlapping-lease-root");
    const plan = await asOwner(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["overlapping-lease-root"],
      }),
    );
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: OWNER,
      idempotencyKey: "overlapping-leases",
      status: "queued",
      eligibleCount: 1,
    });
    const results = await Promise.all([
      asOwner(() => processPurge(operationId)),
      asOwner(() => processPurge(operationId)),
    ]);
    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(operation.deletedCount).toBe(1);
    expect(operation.status).toBe("succeeded");
  });

  it("enforces one durable operation per plan", async () => {
    await insertTrashed("duplicate-root");
    const plan = await asOwner(() =>
      planPurge.run({ mode: "selection", documentIds: ["duplicate-root"] }),
    );
    const base = {
      planId: plan.planId,
      actorEmail: OWNER,
      status: "queued",
      eligibleCount: 1,
    };
    await getDb()
      .insert(schema.contentTrashPurgeOperations)
      .values({
        ...base,
        id: crypto.randomUUID(),
        idempotencyKey: "first",
      });
    await expect(
      getDb()
        .insert(schema.contentTrashPurgeOperations)
        .values({
          ...base,
          id: crypto.randomUUID(),
          idempotencyKey: "second",
        }),
    ).rejects.toThrow();
  });
});
