import { randomBytes, randomUUID } from "node:crypto";

import { getSettingEntry, mutateSetting } from "@agent-native/core/settings";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { inspectPermanentDeleteRelationships } from "../../actions/delete-document.js";
import {
  CONTENT_TRASH_RETENTION_DAYS,
  CONTENT_TRASH_RETENTION_MS,
  type ContentTrashRetention,
  contentTrashRetentionDeletionsBeginAt,
} from "../../shared/content-trash-retention.js";
import { getDb, schema } from "../db/index.js";
import {
  CONTENT_TRASH_RETENTION_ACTOR,
  CONTENT_TRASH_RETENTION_PLAN_MODE,
  type ContentTrashRetentionPlanFilters,
  dispatchContentTrashPurge,
  hashTrashScopeToken,
  parseContentTrashRetentionPlanFilters,
} from "./content-trash-purge.js";
import { firstRow } from "./first-row.js";

export const CONTENT_TRASH_RETENTION_SWEEP_ID = "content-trash-retention";
export const CONTENT_TRASH_RETENTION_SETTING_KEY = "content-trash-retention";
export const CONTENT_TRASH_RETENTION_IDLE_REARM_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_UNITS = 200;
const STALLED_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
const ROOT_PAGE_SIZE = 100;
const MAX_ROOT_PAGES = 10;
const PLANNING_RESERVE_MS = 15_000;
const PLAN_ITEM_INSERT_CHUNK = 500;
const PUBLISH_LOCK = "content-trash-retention:publish";
const UNFINISHED_STATUSES = ["queued", "running", "retryable"];

type Db = ReturnType<typeof getDb>;

type RetentionScan = ContentTrashRetentionPlanFilters["scan"];

type ScanCursor = NonNullable<RetentionScan["stoppedAt"]>;

type RetentionItem = {
  id: string;
  rootId: string;
  title: string;
  ownerEmail: string;
  parentId: string | null;
  spaceId: string | null;
  trashedAt: string;
};

type RetentionUnit = {
  rootId: string;
  ownerEmail: string;
  items: RetentionItem[];
  fingerprint: string;
  adjacentDocumentIds: Set<string>;
};

export type ContentTrashRetentionRun =
  | { outcome: "waiting"; deletionsBeginAt: string }
  | {
      outcome: "rearmed";
      deletionsBeginAt: string;
      cancelledOperationIds: string[];
    }
  | { outcome: "in-progress"; operationId: string; resumed: boolean }
  | { outcome: "done-today"; operationId: string }
  | { outcome: "claimed-elsewhere" }
  | {
      outcome: "started";
      operationId: string;
      units: number;
      documents: number;
    };

class RetentionRunClaimedElsewhereError extends Error {}

class RetentionRunInProgressError extends Error {
  constructor(readonly operationId: string) {
    super(`Automatic Trash deletion ${operationId} is still unfinished`);
  }
}

const retentionSettingSchema = z.object({
  startedAt: z.iso.datetime(),
  lastSweepAt: z.iso.datetime().optional(),
});

function parseRetentionSetting(value: unknown) {
  const parsed = retentionSettingSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Setting "${CONTENT_TRASH_RETENTION_SETTING_KEY}" is invalid; automatic Trash deletion will not run until it is repaired: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function readContentTrashRetention(): Promise<ContentTrashRetention> {
  const entry = await getSettingEntry(CONTENT_TRASH_RETENTION_SETTING_KEY, {
    bypassCache: true,
  });
  const startedAt = entry.found
    ? parseRetentionSetting(entry.value).startedAt
    : null;
  return {
    retentionDays: CONTENT_TRASH_RETENTION_DAYS,
    startedAt,
    deletionsBeginAt: startedAt
      ? contentTrashRetentionDeletionsBeginAt(startedAt)
      : null,
  };
}

async function recordContentTrashRetentionSweep(
  now: Date,
  idleRearmMs: number,
) {
  const nowIso = now.toISOString();
  let rearmed = false;
  const stored = await mutateSetting(
    CONTENT_TRASH_RETENTION_SETTING_KEY,
    (current) => {
      rearmed = false;
      if (current === null) return { startedAt: nowIso, lastSweepAt: nowIso };
      const setting = parseRetentionSetting(current);
      const sinceLastSweep = setting.lastSweepAt
        ? now.getTime() - Date.parse(setting.lastSweepAt)
        : null;
      if (sinceLastSweep !== null && sinceLastSweep > idleRearmMs) {
        rearmed = setting.startedAt < nowIso;
        return {
          startedAt: rearmed ? nowIso : setting.startedAt,
          lastSweepAt: nowIso,
        };
      }
      if (sinceLastSweep !== null && sinceLastSweep < HEARTBEAT_INTERVAL_MS) {
        return current;
      }
      return { startedAt: setting.startedAt, lastSweepAt: nowIso };
    },
    { validateStoredValue: (value) => void parseRetentionSetting(value) },
  );
  return { startedAt: parseRetentionSetting(stored).startedAt, rearmed };
}

async function cancelUnfinishedRetentionOperations(db: Db) {
  const reason =
    "Cancelled because automatic deletion had stopped running; its 30 days started again";
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${PUBLISH_LOCK}, 0::bigint))`,
    );
    const now = new Date().toISOString();
    const cancelled = await tx
      .update(schema.contentTrashPurgeOperations)
      .set({
        status: "failed",
        lastError: reason,
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            schema.contentTrashPurgeOperations.actorEmail,
            CONTENT_TRASH_RETENTION_ACTOR,
          ),
          inArray(
            schema.contentTrashPurgeOperations.status,
            UNFINISHED_STATUSES,
          ),
        ),
      )
      .returning({
        id: schema.contentTrashPurgeOperations.id,
        planId: schema.contentTrashPurgeOperations.planId,
      });
    if (cancelled.length > 0) {
      await tx
        .update(schema.contentTrashPurgePlanItems)
        .set({ outcome: "cancelled", outcomeDetail: reason, completedAt: now })
        .where(
          and(
            inArray(
              schema.contentTrashPurgePlanItems.planId,
              cancelled.map(({ planId }) => planId),
            ),
            eq(schema.contentTrashPurgePlanItems.outcome, "pending"),
          ),
        );
    }
    return cancelled.map(({ id }) => id);
  });
}

function isStalled(
  operation: {
    status: string;
    leaseExpiresAt: string | null;
    updatedAt: string;
  },
  now: number,
) {
  if (operation.status === "running") {
    return (
      !operation.leaseExpiresAt || Date.parse(operation.leaseExpiresAt) <= now
    );
  }
  return Date.parse(operation.updatedAt) <= now - STALLED_MS;
}

async function dispatchOrRelease(
  db: Db,
  operation: { id: string; status: string; updatedAt: string },
  dispatch: (operationId: string) => Promise<void>,
) {
  try {
    await dispatch(operation.id);
  } catch (error) {
    await db
      .update(schema.contentTrashPurgeOperations)
      .set({
        status: "retryable",
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.contentTrashPurgeOperations.id, operation.id),
          eq(schema.contentTrashPurgeOperations.status, operation.status),
          eq(schema.contentTrashPurgeOperations.updatedAt, operation.updatedAt),
        ),
      );
    throw error;
  }
}

async function isProtectedTrashGroup(
  db: Db,
  documentIds: string[],
  visited: Set<string>,
): Promise<boolean> {
  for (const id of documentIds) visited.add(id);
  // guard:allow-unscoped — Empty Trash's blockers, checked for the system across owners before anything is planned.
  const sourceBacked = firstRow(
    await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, documentIds),
          isNotNull(schema.documents.sourceMode),
        ),
      )
      .limit(1),
  );
  if (sourceBacked) return true;
  // guard:allow-unscoped — the collections these Pages host; Empty Trash blocks the same ones.
  const databases = await db
    .select({
      id: schema.contentDatabases.id,
      systemRole: schema.contentDatabases.systemRole,
    })
    .from(schema.contentDatabases)
    .where(inArray(schema.contentDatabases.documentId, documentIds));
  if (databases.some((database) => database.systemRole)) return true;
  const databaseIds = databases.map(({ id }) => id);
  if (databaseIds.length > 0) {
    // guard:allow-unscoped — a source-connected collection blocks its whole Trash group, whoever connected it.
    const source = firstRow(
      await db
        .select({ id: schema.contentDatabaseSources.id })
        .from(schema.contentDatabaseSources)
        .where(inArray(schema.contentDatabaseSources.databaseId, databaseIds))
        .limit(1),
    );
    if (source) return true;
  }
  // guard:allow-unscoped — Pages a blocker reaches this group through: its sub-pages and its collections' members.
  const dependents = await db
    .select({
      id: schema.documents.id,
      trashRootId: schema.documents.trashRootId,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.documents)
    .where(
      or(
        inArray(schema.documents.parentId, documentIds),
        databaseIds.length > 0
          ? inArray(
              schema.documents.id,
              db
                .select({ id: schema.contentDatabaseItems.documentId })
                .from(schema.contentDatabaseItems)
                .where(
                  inArray(schema.contentDatabaseItems.databaseId, databaseIds),
                ),
            )
          : undefined,
      ),
    );
  const outside = dependents.filter(({ id }) => !visited.has(id));
  const liveIds = outside
    .filter((dependent) => !dependent.trashedAt)
    .map(({ id }) => id);
  if (liveIds.length > 0) {
    // guard:allow-unscoped — a live Page whose collection sits in legacy database Trash; Empty Trash blocks the group above it.
    const legacy = firstRow(
      await db
        .select({ id: schema.contentDatabases.id })
        .from(schema.contentDatabases)
        .where(
          and(
            inArray(schema.contentDatabases.documentId, liveIds),
            isNotNull(schema.contentDatabases.deletedAt),
          ),
        )
        .limit(1),
    );
    if (legacy) return true;
  }
  const groupRoots = new Set(
    outside
      .filter((dependent) => dependent.trashedAt)
      .map((dependent) => dependent.trashRootId ?? dependent.id),
  );
  for (const rootId of groupRoots) {
    // guard:allow-unscoped — the rest of a dependent Page's Trash group, checked with the same blockers.
    const group = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          or(
            eq(schema.documents.trashRootId, rootId),
            eq(schema.documents.id, rootId),
          ),
          isNotNull(schema.documents.trashedAt),
        ),
      );
    const groupIds = group.map(({ id }) => id).filter((id) => !visited.has(id));
    if (groupIds.length === 0) continue;
    if (await isProtectedTrashGroup(db, groupIds, visited)) return true;
  }
  return false;
}

async function inspectRetentionUnit(
  db: Db,
  rootId: string,
  items: RetentionItem[],
  cutoff: string,
): Promise<RetentionUnit | null> {
  const ownerEmail = items[0]?.ownerEmail;
  if (
    !ownerEmail ||
    !items.some((item) => item.id === rootId) ||
    items.some(
      (item) => item.ownerEmail !== ownerEmail || item.trashedAt > cutoff,
    )
  ) {
    return null;
  }
  const documentIds = items.map((item) => item.id);
  if (await isProtectedTrashGroup(db, documentIds, new Set())) return null;
  const relationships = await inspectPermanentDeleteRelationships(
    db,
    documentIds,
    ownerEmail,
  );
  if (relationships.inaccessibleRelationship) return null;
  const hostedDatabaseIds = new Set(
    relationships.databases.map(({ id }) => id),
  );
  // guard:allow-unscoped — children of Pages the system selected, to keep neighbouring Trash roots out of one run.
  const children = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(inArray(schema.documents.parentId, documentIds));
  return {
    rootId,
    ownerEmail,
    items,
    fingerprint: relationships.fingerprint,
    adjacentDocumentIds: new Set([
      ...items.flatMap((item) => (item.parentId ? [item.parentId] : [])),
      ...children.map(({ id }) => id),
      ...relationships.memberships
        .filter((membership) => hostedDatabaseIds.has(membership.databaseId))
        .map((membership) => membership.documentId),
    ]),
  };
}

async function latestScanStop(db: Db): Promise<ScanCursor | null> {
  const plan = firstRow(
    await db
      .select({ filtersJson: schema.contentTrashPurgePlans.filtersJson })
      .from(schema.contentTrashPurgePlans)
      .where(
        and(
          eq(
            schema.contentTrashPurgePlans.actorEmail,
            CONTENT_TRASH_RETENTION_ACTOR,
          ),
          eq(
            schema.contentTrashPurgePlans.mode,
            CONTENT_TRASH_RETENTION_PLAN_MODE,
          ),
        ),
      )
      .orderBy(desc(schema.contentTrashPurgePlans.createdAt))
      .limit(1),
  );
  if (!plan) return null;
  const { scan } = parseContentTrashRetentionPlanFilters(plan.filtersJson);
  return scan.exhausted ? null : scan.stoppedAt;
}

async function findContentTrashRetentionUnits(
  db: Db,
  options: {
    cutoff: string;
    deadlineAt: number;
    maxUnits: number;
    pageSize: number;
    maxPages: number;
    startAfter: ScanCursor | null;
    signal?: AbortSignal | undefined;
  },
): Promise<{ units: RetentionUnit[]; scan: RetentionScan }> {
  const chosen: RetentionUnit[] = [];
  const chosenDocumentIds = new Set<string>();
  const chosenAdjacentIds = new Set<string>();
  const document = schema.documents;
  const member = alias(schema.documents, "retention_member");
  const memberDatabase = alias(
    schema.contentDatabases,
    "retention_member_database",
  );
  let cursor = options.startAfter;
  let stoppedAt = options.startAfter;
  const result = (exhausted: boolean) => ({
    units: chosen,
    scan: { startedAfter: options.startAfter, stoppedAt, exhausted },
  });
  const outOfTime = () => Date.now() > options.deadlineAt - PLANNING_RESERVE_MS;
  for (let page = 0; page < options.maxPages; page += 1) {
    if (outOfTime()) return result(false);
    options.signal?.throwIfAborted();
    // guard:allow-unscoped — automatic deletion runs as the system across every space; each unit is re-checked when it is deleted.
    const roots = await db
      .select({ id: document.id, trashedAt: document.trashedAt })
      .from(document)
      .where(
        and(
          isNotNull(document.trashedAt),
          eq(document.trashRootId, document.id),
          lte(document.trashedAt, options.cutoff),
          notExists(
            db
              .select({ id: member.id })
              .from(member)
              .where(
                and(
                  eq(member.trashRootId, document.id),
                  isNotNull(member.trashedAt),
                  or(
                    isNotNull(member.sourceMode),
                    gt(member.trashedAt, options.cutoff),
                    ne(member.ownerEmail, document.ownerEmail),
                  ),
                ),
              ),
          ),
          notExists(
            db
              .select({ id: memberDatabase.id })
              .from(memberDatabase)
              .innerJoin(member, eq(member.id, memberDatabase.documentId))
              .where(
                and(
                  eq(member.trashRootId, document.id),
                  isNotNull(member.trashedAt),
                  or(
                    isNotNull(memberDatabase.systemRole),
                    exists(
                      db
                        .select({ id: schema.contentDatabaseSources.id })
                        .from(schema.contentDatabaseSources)
                        .where(
                          eq(
                            schema.contentDatabaseSources.databaseId,
                            memberDatabase.id,
                          ),
                        ),
                    ),
                  ),
                ),
              ),
          ),
          cursor
            ? or(
                gt(document.trashedAt, cursor.trashedAt),
                and(
                  eq(document.trashedAt, cursor.trashedAt),
                  gt(document.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(document.trashedAt), asc(document.id))
      .limit(options.pageSize);
    // guard:allow-unscoped — the Pages trashed with the system-selected roots above.
    const members = roots.length
      ? await db
          .select({
            id: document.id,
            rootId: document.trashRootId,
            title: document.title,
            ownerEmail: document.ownerEmail,
            parentId: document.parentId,
            spaceId: document.spaceId,
            trashedAt: document.trashedAt,
          })
          .from(document)
          .where(
            and(
              inArray(
                document.trashRootId,
                roots.map(({ id }) => id),
              ),
              isNotNull(document.trashedAt),
            ),
          )
      : [];
    const itemsByRoot = new Map<string, RetentionItem[]>();
    for (const item of members) {
      if (!item.rootId || !item.trashedAt) continue;
      const items = itemsByRoot.get(item.rootId) ?? [];
      items.push({ ...item, rootId: item.rootId, trashedAt: item.trashedAt });
      itemsByRoot.set(item.rootId, items);
    }
    for (const root of roots) {
      if (chosen.length >= options.maxUnits || outOfTime()) {
        return result(false);
      }
      options.signal?.throwIfAborted();
      if (!root.trashedAt) continue;
      stoppedAt = { trashedAt: root.trashedAt, id: root.id };
      const unit = await inspectRetentionUnit(
        db,
        root.id,
        itemsByRoot.get(root.id) ?? [],
        options.cutoff,
      );
      if (
        !unit ||
        unit.items.some((item) => chosenAdjacentIds.has(item.id)) ||
        [...unit.adjacentDocumentIds].some((id) => chosenDocumentIds.has(id))
      ) {
        continue;
      }
      chosen.push(unit);
      for (const item of unit.items) chosenDocumentIds.add(item.id);
      for (const id of unit.adjacentDocumentIds) chosenAdjacentIds.add(id);
    }
    if (roots.length < options.pageSize) return result(true);
    cursor = stoppedAt;
  }
  return result(false);
}

async function startRetentionOperation(
  db: Db,
  options: {
    idempotencyKey: string;
    cutoff: string;
    startedAt: string;
    units: RetentionUnit[];
    scan: RetentionScan;
  },
) {
  const planId = randomUUID();
  const operationId = randomUUID();
  const now = new Date().toISOString();
  const items = options.units.flatMap((unit) =>
    unit.items.map((item) => ({
      id: randomUUID(),
      planId,
      unitId: unit.rootId,
      rootDocumentId: unit.rootId,
      documentId: item.id,
      ownerEmail: unit.ownerEmail,
      title: item.title,
      spaceId: item.spaceId,
      expectedTrashedAt: item.trashedAt,
      expectedParentId: item.parentId,
      expectedScopeFingerprint: unit.fingerprint,
      ancestorUnitIdsJson: "[]",
      eligibility: "eligible",
      outcome: "pending",
      createdAt: now,
    })),
  );
  const filters: ContentTrashRetentionPlanFilters = {
    cutoff: options.cutoff,
    startedAt: options.startedAt,
    scan: options.scan,
  };
  const operations = schema.contentTrashPurgeOperations;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${PUBLISH_LOCK}, 0::bigint))`,
    );
    const sameDay = firstRow(
      await tx
        .select({ id: operations.id })
        .from(operations)
        .where(
          and(
            eq(operations.actorEmail, CONTENT_TRASH_RETENTION_ACTOR),
            eq(operations.idempotencyKey, options.idempotencyKey),
          ),
        )
        .limit(1),
    );
    if (sameDay) throw new RetentionRunClaimedElsewhereError();
    const active = firstRow(
      await tx
        .select({ id: operations.id })
        .from(operations)
        .where(
          and(
            eq(operations.actorEmail, CONTENT_TRASH_RETENTION_ACTOR),
            inArray(operations.status, UNFINISHED_STATUSES),
          ),
        )
        .limit(1),
    );
    if (active) throw new RetentionRunInProgressError(active.id);
    const claimedRows = await tx
      .insert(operations)
      .values({
        id: operationId,
        planId,
        actorEmail: CONTENT_TRASH_RETENTION_ACTOR,
        orgId: null,
        idempotencyKey: options.idempotencyKey,
        status: items.length > 0 ? "queued" : "succeeded",
        eligibleCount: items.length,
        blockedCount: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: items.length > 0 ? null : now,
      })
      .onConflictDoNothing({
        target: [operations.actorEmail, operations.idempotencyKey],
      })
      .returning({ id: operations.id });
    const claimed = firstRow(claimedRows);
    if (!claimed) throw new RetentionRunClaimedElsewhereError();
    await tx.insert(schema.contentTrashPurgePlans).values({
      id: planId,
      actorEmail: CONTENT_TRASH_RETENTION_ACTOR,
      orgId: null,
      mode: CONTENT_TRASH_RETENTION_PLAN_MODE,
      spaceId: null,
      filtersJson: JSON.stringify(filters),
      state: "confirmed",
      scopeTokenHash: hashTrashScopeToken(
        randomBytes(32).toString("base64url"),
      ),
      eligibleCount: items.length,
      blockedCount: 0,
      expiresAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < items.length; index += PLAN_ITEM_INSERT_CHUNK) {
      await tx
        .insert(schema.contentTrashPurgePlanItems)
        .values(items.slice(index, index + PLAN_ITEM_INSERT_CHUNK));
    }
  });
  return { operationId, documents: items.length, updatedAt: now };
}

export async function runContentTrashRetention(options: {
  deadlineAt: number;
  signal?: AbortSignal | undefined;
  now?: Date;
  maxUnits?: number;
  scanPageSize?: number;
  scanPages?: number;
  idleRearmMs?: number;
  dispatch?: (operationId: string) => Promise<void>;
}): Promise<ContentTrashRetentionRun> {
  const db = getDb();
  const now = options.now ?? new Date();
  const dispatch = options.dispatch ?? dispatchContentTrashPurge;
  const sweep = await recordContentTrashRetentionSweep(
    now,
    options.idleRearmMs ?? CONTENT_TRASH_RETENTION_IDLE_REARM_MS,
  );
  const deletionsBeginAt = contentTrashRetentionDeletionsBeginAt(
    sweep.startedAt,
  );
  if (sweep.rearmed) {
    return {
      outcome: "rearmed",
      deletionsBeginAt,
      cancelledOperationIds: await cancelUnfinishedRetentionOperations(db),
    };
  }

  const operations = schema.contentTrashPurgeOperations;
  const unfinishedRows = await db
    .select({
      id: operations.id,
      status: operations.status,
      leaseExpiresAt: operations.leaseExpiresAt,
      updatedAt: operations.updatedAt,
    })
    .from(operations)
    .where(
      and(
        eq(operations.actorEmail, CONTENT_TRASH_RETENTION_ACTOR),
        inArray(operations.status, UNFINISHED_STATUSES),
      ),
    )
    .orderBy(asc(operations.createdAt))
    .limit(1);
  const unfinished = firstRow(unfinishedRows);
  if (unfinished) {
    const resumed = isStalled(unfinished, Date.now());
    if (resumed) await dispatchOrRelease(db, unfinished, dispatch);
    return { outcome: "in-progress", operationId: unfinished.id, resumed };
  }

  const idempotencyKey = `retention:${now.toISOString().slice(0, 10)}`;
  const todayRows = await db
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.actorEmail, CONTENT_TRASH_RETENTION_ACTOR),
        eq(operations.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  const today = firstRow(todayRows);
  if (today) return { outcome: "done-today", operationId: today.id };

  if (deletionsBeginAt > now.toISOString()) {
    return { outcome: "waiting", deletionsBeginAt };
  }
  const cutoff = new Date(
    now.getTime() - CONTENT_TRASH_RETENTION_MS,
  ).toISOString();
  const { units, scan } = await findContentTrashRetentionUnits(db, {
    cutoff,
    deadlineAt: options.deadlineAt,
    maxUnits: options.maxUnits ?? MAX_UNITS,
    pageSize: options.scanPageSize ?? ROOT_PAGE_SIZE,
    maxPages: options.scanPages ?? MAX_ROOT_PAGES,
    startAfter: await latestScanStop(db),
    signal: options.signal,
  });
  let started: Awaited<ReturnType<typeof startRetentionOperation>>;
  try {
    started = await startRetentionOperation(db, {
      idempotencyKey,
      cutoff,
      startedAt: sweep.startedAt,
      units,
      scan,
    });
  } catch (error) {
    if (error instanceof RetentionRunClaimedElsewhereError) {
      return { outcome: "claimed-elsewhere" };
    }
    if (error instanceof RetentionRunInProgressError) {
      return {
        outcome: "in-progress",
        operationId: error.operationId,
        resumed: false,
      };
    }
    throw error;
  }
  if (started.documents === 0) {
    return { outcome: "done-today", operationId: started.operationId };
  }
  await dispatchOrRelease(
    db,
    { id: started.operationId, status: "queued", updatedAt: started.updatedAt },
    dispatch,
  );
  return {
    outcome: "started",
    operationId: started.operationId,
    units: units.length,
    documents: started.documents,
  };
}
