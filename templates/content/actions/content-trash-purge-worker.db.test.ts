import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-trash-purge-worker-${process.pid}-${Date.now()}.pglite`,
);
const ACTOR = "purge-worker@example.test";
const OTHER = "purge-worker-owner@example.test";
const ORG_ID = "purge-worker-org";
const SPACE_ID = "purge-worker-space";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let planPurge: typeof import("./plan-content-trash-purge.js").default;
let processPurge: typeof import("../server/lib/content-trash-purge.js").processContentTrashPurge;
let executePurge: typeof import("./execute-content-trash-purge.js").default;

const asActor = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: ACTOR, orgId: ORG_ID }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  planPurge = (await import("./plan-content-trash-purge.js")).default;
  processPurge = (await import("../server/lib/content-trash-purge.js"))
    .processContentTrashPurge;
  executePurge = (await import("./execute-content-trash-purge.js")).default;
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
    args: [ORG_ID, "Purge worker", ACTOR, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
    args: ["purge-worker-member", ORG_ID, ACTOR, "owner", Date.now()],
  });
  await getDb().insert(schema.contentSpaces).values({
    id: SPACE_ID,
    name: "Purge worker",
    kind: "organization",
    ownerEmail: ACTOR,
    orgId: ORG_ID,
    filesDatabaseId: "purge-worker-files",
    createdBy: ACTOR,
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(() => rmSync(TEST_DB_PATH, { force: true, recursive: true }));

async function insertDocument(
  id: string,
  options: {
    ownerEmail?: string;
    parentId?: string | null;
    trashed?: boolean;
    trashRootId?: string;
  } = {},
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      spaceId: SPACE_ID,
      ownerEmail: options.ownerEmail ?? ACTOR,
      orgId: ORG_ID,
      title: id,
      content: "",
      visibility: "private",
      parentId: options.parentId ?? null,
      trashedAt: options.trashed === false ? null : now,
      trashRootId:
        options.trashed === false ? null : (options.trashRootId ?? id),
      createdAt: now,
      updatedAt: now,
    });
}

async function shareDocument(
  id: string,
  documentId: string,
  role: "viewer" | "editor" | "admin",
) {
  await getDb().insert(schema.documentShares).values({
    id,
    resourceId: documentId,
    principalType: "user",
    principalId: ACTOR,
    role,
    createdBy: OTHER,
  });
}

async function queueOperation(
  planId: string,
  eligibleCount: number,
  idempotencyKey: string,
) {
  const operationId = crypto.randomUUID();
  await getDb().insert(schema.contentTrashPurgeOperations).values({
    id: operationId,
    planId,
    actorEmail: ACTOR,
    orgId: ORG_ID,
    idempotencyKey,
    status: "queued",
    eligibleCount,
  });
  return operationId;
}

describe("Content Trash purge worker", () => {
  it("blocks the whole unit when access to a frozen descendant is revoked", async () => {
    await insertDocument("revoked-descendant-root", { ownerEmail: OTHER });
    await insertDocument("revoked-descendant-child", {
      ownerEmail: OTHER,
      parentId: "revoked-descendant-root",
      trashRootId: "revoked-descendant-root",
    });
    await shareDocument(
      "revoked-root-share",
      "revoked-descendant-root",
      "admin",
    );
    await shareDocument(
      "revoked-child-share",
      "revoked-descendant-child",
      "admin",
    );
    const plan = await asActor(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["revoked-descendant-root"],
      }),
    );
    await getDb()
      .delete(schema.documentShares)
      .where(eq(schema.documentShares.id, "revoked-child-share"));
    const operationId = await queueOperation(
      plan.planId,
      plan.eligibleCount,
      "revoked-descendant",
    );

    await asActor(() => processPurge(operationId));

    const [operation, items, documents] = await Promise.all([
      getDb()
        .select()
        .from(schema.contentTrashPurgeOperations)
        .where(eq(schema.contentTrashPurgeOperations.id, operationId))
        .then((rows: any[]) => rows[0]),
      getDb()
        .select({ outcome: schema.contentTrashPurgePlanItems.outcome })
        .from(schema.contentTrashPurgePlanItems)
        .where(eq(schema.contentTrashPurgePlanItems.planId, plan.planId)),
      getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.trashRootId, "revoked-descendant-root")),
    ]);
    expect(operation.status).toBe("partially_completed");
    expect(items.every((item: any) => item.outcome === "blocked")).toBe(true);
    expect(documents).toHaveLength(2);
  });

  it("uses the planner block-owned host-editor authority during execution", async () => {
    await insertDocument("block-host", {
      ownerEmail: OTHER,
      trashed: false,
    });
    await insertDocument("block-owned-row", {
      ownerEmail: OTHER,
      parentId: "block-host",
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "block-owned-database",
      spaceId: SPACE_ID,
      ownerEmail: OTHER,
      orgId: ORG_ID,
      documentId: "block-owned-row",
      ownerDocumentId: "block-host",
      ownerBlockId: "block-id",
      title: "Block-owned",
    });
    await shareDocument("block-row-share", "block-owned-row", "viewer");
    await shareDocument("block-host-share", "block-host", "editor");
    const plan = await asActor(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["block-owned-row"],
      }),
    );
    expect(plan.eligibleCount).toBe(1);
    const operationId = await queueOperation(
      plan.planId,
      plan.eligibleCount,
      "block-owned",
    );

    await asActor(() => processPurge(operationId));

    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    const row = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.id, "block-owned-row"));
    expect(operation.status).toBe("succeeded");
    expect(row).toHaveLength(0);
  });

  it("keeps pending work retryable after an unexpected deletion failure", async () => {
    await insertDocument("retryable-root");
    const plan = await asActor(() =>
      planPurge.run({ mode: "selection", documentIds: ["retryable-root"] }),
    );
    await getDb()
      .update(schema.contentTrashPurgePlanItems)
      .set({ ownerEmail: OTHER })
      .where(eq(schema.contentTrashPurgePlanItems.planId, plan.planId));
    const operationId = await queueOperation(
      plan.planId,
      plan.eligibleCount,
      "retryable-failure",
    );

    const result = await asActor(() => processPurge(operationId));

    const [operation, item] = await Promise.all([
      getDb()
        .select()
        .from(schema.contentTrashPurgeOperations)
        .where(eq(schema.contentTrashPurgeOperations.id, operationId))
        .then((rows: any[]) => rows[0]),
      getDb()
        .select()
        .from(schema.contentTrashPurgePlanItems)
        .where(eq(schema.contentTrashPurgePlanItems.planId, plan.planId))
        .then((rows: any[]) => rows[0]),
    ]);
    expect(result.status).toBe("retryable");
    expect(operation.status).toBe("retryable");
    expect(operation.lastError).toContain("Document must be in Trash");
    expect(item.outcome).toBe("pending");
  });

  it("redispatches an expired running operation through execute", async () => {
    await insertDocument("expired-running-root");
    const plan = await asActor(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["expired-running-root"],
      }),
    );
    const operationId = crypto.randomUUID();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: ACTOR,
      orgId: ORG_ID,
      idempotencyKey: "expired-running",
      status: "running",
      eligibleCount: plan.eligibleCount,
      leaseToken: "expired-lease",
      leaseExpiresAt: "2020-01-01T00:00:00.000Z",
    });

    await asActor(() =>
      executePurge.run({
        planId: plan.planId,
        scopeToken: plan.scopeToken,
        idempotencyKey: "expired-running",
      }),
    ).catch(() => undefined);

    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(operation.status).not.toBe("running");
  });

  it("leaves a running operation with a live lease to its current worker", async () => {
    await insertDocument("live-running-root");
    const plan = await asActor(() =>
      planPurge.run({
        mode: "selection",
        documentIds: ["live-running-root"],
      }),
    );
    const operationId = crypto.randomUUID();
    const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
    await getDb().insert(schema.contentTrashPurgeOperations).values({
      id: operationId,
      planId: plan.planId,
      actorEmail: ACTOR,
      orgId: ORG_ID,
      idempotencyKey: "live-running",
      status: "running",
      eligibleCount: plan.eligibleCount,
      leaseToken: "live-lease",
      leaseExpiresAt,
    });

    const result = await asActor(() =>
      executePurge.run({
        planId: plan.planId,
        scopeToken: plan.scopeToken,
        idempotencyKey: "live-running",
      }),
    );

    expect(result).toEqual({ operationId, status: "running" });
    const [operation] = await getDb()
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId));
    expect(operation.leaseToken).toBe("live-lease");
    expect(operation.leaseExpiresAt).toBe(leaseExpiresAt);
  });
});
