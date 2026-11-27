import { randomBytes, randomUUID } from "node:crypto";

import {
  ensureSettingsStore,
  getSettingEntry,
  getSettingsEmitter,
} from "@agent-native/core/settings";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { inspectPermanentDeleteRelationships } from "../../actions/delete-document.js";
import {
  CONTENT_TRASH_RETENTION_DAYS,
  CONTENT_TRASH_RETENTION_MS,
  type ContentTrashRetention,
  contentTrashRetentionDeletionsBeginAt,
} from "../../shared/content-trash-retention.js";
import { getDb, schema } from "../db/index.js";
import {
  CONTENT_TRASH_PROTECTION_GROUP_BUDGET,
  inspectTrashGroupProtection,
} from "./content-trash-protection.js";
import {
  CONTENT_TRASH_RETENTION_ACTOR,
  CONTENT_TRASH_RETENTION_PLAN_MODE,
  CONTENT_TRASH_RETENTION_REARM_REASON,
  CONTENT_TRASH_RETENTION_SETTING_KEY,
  type ContentTrashRetentionPlanFilters,
  type ContentTrashRetentionSetting,
  dispatchContentTrashPurge,
  hashTrashScopeToken,
  lockContentTrashRetentionState,
  parseContentTrashRetentionPlanFilters,
  parseContentTrashRetentionSetting,
} from "./content-trash-purge.js";
import { firstRow } from "./first-row.js";

export { CONTENT_TRASH_RETENTION_SETTING_KEY };
export const CONTENT_TRASH_RETENTION_SWEEP_ID = "content-trash-retention";
export const CONTENT_TRASH_RETENTION_IDLE_REARM_MS = 3 * 24 * 60 * 60 * 1000;
export const CONTENT_TRASH_RETENTION_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
const MAX_UNITS = 200;
const STALLED_MS = 2 * 60 * 1000;
const ROOT_PAGE_SIZE = 100;
const MAX_ROOT_PAGES = 10;
const PLANNING_RESERVE_MS = 15_000;
const PLAN_ITEM_INSERT_CHUNK = 500;
const UNFINISHED_STATUSES = ["queued", "running", "retryable"];
const OVER_BUDGET_REASON = "too-many-related-pages";

type Db = ReturnType<typeof getDb>;

type RetentionScan = NonNullable<ContentTrashRetentionPlanFilters["scan"]>;

type ScanCursor = NonNullable<RetentionScan["stoppedAt"]>;

type ScanPass = { startAfter: ScanCursor | null; bound: ScanCursor };

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

type SweepDecision =
  | { kind: "fresh"; startedAt: string }
  | {
      kind: "first-start" | "rearm" | "heartbeat";
      next: ContentTrashRetentionSetting;
    };

type SweepRecord = {
  startedAt: string;
  rearmed: boolean;
  cancelledOperationIds: string[];
};

export async function readContentTrashRetention(): Promise<ContentTrashRetention> {
  const entry = await getSettingEntry(CONTENT_TRASH_RETENTION_SETTING_KEY, {
    bypassCache: true,
  });
  const startedAt = entry.found
    ? parseContentTrashRetentionSetting(entry.value).startedAt
    : null;
  return {
    retentionDays: CONTENT_TRASH_RETENTION_DAYS,
    startedAt,
    deletionsBeginAt: startedAt
      ? contentTrashRetentionDeletionsBeginAt(startedAt)
      : null,
  };
}

function decideRetentionSweep(
  current: ContentTrashRetentionSetting | null,
  now: Date,
  idleRearmMs: number,
): SweepDecision {
  const nowIso = now.toISOString();
  if (!current) {
    return {
      kind: "first-start",
      next: { startedAt: nowIso, lastSweepAt: nowIso },
    };
  }
  const sinceRecordedSweep = current.lastSweepAt
    ? now.getTime() - Date.parse(current.lastSweepAt)
    : null;
  if (
    sinceRecordedSweep !== null &&
    sinceRecordedSweep > idleRearmMs &&
    current.startedAt < nowIso
  ) {
    return { kind: "rearm", next: { startedAt: nowIso, lastSweepAt: nowIso } };
  }
  if (
    sinceRecordedSweep !== null &&
    sinceRecordedSweep < CONTENT_TRASH_RETENTION_HEARTBEAT_INTERVAL_MS
  ) {
    return { kind: "fresh", startedAt: current.startedAt };
  }
  return {
    kind: "heartbeat",
    next: { startedAt: current.startedAt, lastSweepAt: nowIso },
  };
}

async function cancelUnfinishedRetentionOperations(transactionDb: Db) {
  const now = new Date().toISOString();
  const cancelled = await transactionDb
    .update(schema.contentTrashPurgeOperations)
    .set({
      status: "failed",
      lastError: CONTENT_TRASH_RETENTION_REARM_REASON,
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
        inArray(schema.contentTrashPurgeOperations.status, UNFINISHED_STATUSES),
      ),
    )
    .returning({
      id: schema.contentTrashPurgeOperations.id,
      planId: schema.contentTrashPurgeOperations.planId,
    });
  if (cancelled.length > 0) {
    await transactionDb
      .update(schema.contentTrashPurgePlanItems)
      .set({
        outcome: "cancelled",
        outcomeDetail: CONTENT_TRASH_RETENTION_REARM_REASON,
        completedAt: now,
      })
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
}

async function recordContentTrashRetentionSweep(
  db: Db,
  now: Date,
  idleRearmMs: number,
): Promise<SweepRecord> {
  const entry = await getSettingEntry(CONTENT_TRASH_RETENTION_SETTING_KEY, {
    bypassCache: true,
  });
  if (entry.found) {
    const unlocked = decideRetentionSweep(
      parseContentTrashRetentionSetting(entry.value),
      now,
      idleRearmMs,
    );
    if (unlocked.kind === "fresh") {
      return {
        startedAt: unlocked.startedAt,
        rearmed: false,
        cancelledOperationIds: [],
      };
    }
  }
  await ensureSettingsStore();
  const recorded = await db.transaction(async (tx) => {
    const transactionDb = tx as unknown as Db;
    const decision = decideRetentionSweep(
      await lockContentTrashRetentionState(transactionDb, "exclusive"),
      now,
      idleRearmMs,
    );
    if (decision.kind === "fresh") {
      return {
        startedAt: decision.startedAt,
        rearmed: false,
        cancelledOperationIds: [],
        written: false,
      };
    }
    await transactionDb.execute(sql`
      INSERT INTO public.settings (key, value, updated_at)
      VALUES (${CONTENT_TRASH_RETENTION_SETTING_KEY}, ${JSON.stringify(decision.next)}, ${Date.now()})
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `);
    const cancelledOperationIds =
      decision.kind === "heartbeat"
        ? []
        : await cancelUnfinishedRetentionOperations(transactionDb);
    return {
      startedAt: decision.next.startedAt,
      rearmed: decision.kind === "rearm" || cancelledOperationIds.length > 0,
      cancelledOperationIds,
      written: true,
    };
  });
  if (recorded.written) {
    getSettingsEmitter().emit("settings", {
      source: "settings",
      type: "change",
      key: CONTENT_TRASH_RETENTION_SETTING_KEY,
    });
  }
  return {
    startedAt: recorded.startedAt,
    rearmed: recorded.rearmed,
    cancelledOperationIds: recorded.cancelledOperationIds,
  };
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

async function inspectRetentionUnit(
  db: Db,
  rootId: string,
  items: RetentionItem[],
  options: { cutoff: string; maxGroups: number; deadlineAt: number },
): Promise<
  | { kind: "unit"; unit: RetentionUnit }
  | { kind: "blocked" }
  | { kind: "over-budget" }
  | { kind: "out-of-time" }
> {
  const ownerEmail = items[0]?.ownerEmail;
  if (
    !ownerEmail ||
    !items.some((item) => item.id === rootId) ||
    items.some(
      (item) =>
        item.ownerEmail !== ownerEmail || item.trashedAt > options.cutoff,
    )
  ) {
    return { kind: "blocked" };
  }
  const documentIds = items.map((item) => item.id);
  const protection = await inspectTrashGroupProtection(db, documentIds, {
    maxGroups: options.maxGroups,
    deadlineAt: options.deadlineAt,
  });
  if (protection === "protected") return { kind: "blocked" };
  if (protection !== "clear") return { kind: protection };
  const relationships = await inspectPermanentDeleteRelationships(
    db,
    documentIds,
    ownerEmail,
  );
  if (relationships.inaccessibleRelationship) return { kind: "blocked" };
  const hostedDatabaseIds = new Set(
    relationships.databases.map(({ id }) => id),
  );
  // guard:allow-unscoped — children of Pages the system selected, to keep neighbouring Trash roots out of one run.
  const children = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(inArray(schema.documents.parentId, documentIds));
  return {
    kind: "unit",
    unit: {
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
    },
  };
}

async function latestScanPass(db: Db): Promise<ScanPass | null> {
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
  if (!scan?.bound || scan.exhausted) return null;
  return { startAfter: scan.stoppedAt, bound: scan.bound };
}

async function findContentTrashRetentionUnits(
  db: Db,
  options: {
    cutoff: string;
    deadlineAt: number;
    maxUnits: number;
    pageSize: number;
    maxPages: number;
    maxGroups: number;
    pass: ScanPass | null;
    signal?: AbortSignal | undefined;
  },
): Promise<{
  units: RetentionUnit[];
  scan: RetentionScan;
  skipped: Record<string, string>;
}> {
  const chosen: RetentionUnit[] = [];
  const chosenDocumentIds = new Set<string>();
  const chosenAdjacentIds = new Set<string>();
  const skipped: Record<string, string> = {};
  const document = schema.documents;
  const member = alias(schema.documents, "retention_member");
  const memberDatabase = alias(
    schema.contentDatabases,
    "retention_member_database",
  );
  const eligibleRoot = and(
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
  );
  const after = (position: ScanCursor) =>
    or(
      gt(document.trashedAt, position.trashedAt),
      and(
        eq(document.trashedAt, position.trashedAt),
        gt(document.id, position.id),
      ),
    );
  const atOrBefore = (position: ScanCursor) =>
    or(
      lt(document.trashedAt, position.trashedAt),
      and(
        eq(document.trashedAt, position.trashedAt),
        lte(document.id, position.id),
      ),
    );
  const newestEligibleRoot = async (): Promise<ScanCursor | null> => {
    // guard:allow-unscoped — the newest root this pass will reach, across every space, so roots that become eligible later wait for the next pass.
    const newest = firstRow(
      await db
        .select({ id: document.id, trashedAt: document.trashedAt })
        .from(document)
        .where(eligibleRoot)
        .orderBy(desc(document.trashedAt), desc(document.id))
        .limit(1),
    );
    return newest?.trashedAt
      ? { trashedAt: newest.trashedAt, id: newest.id }
      : null;
  };
  const startAfter = options.pass?.startAfter ?? null;
  const bound = options.pass ? options.pass.bound : await newestEligibleRoot();
  let cursor = startAfter;
  let stoppedAt = startAfter;
  const result = (exhausted: boolean) => ({
    units: chosen,
    skipped,
    scan: { startedAfter: startAfter, stoppedAt, exhausted, bound },
  });
  if (!bound) return result(true);
  const planningDeadline = options.deadlineAt - PLANNING_RESERVE_MS;
  const outOfTime = () => Date.now() > planningDeadline;
  for (let page = 0; page < options.maxPages; page += 1) {
    if (outOfTime()) return result(false);
    options.signal?.throwIfAborted();
    // guard:allow-unscoped — automatic deletion runs as the system across every space; each unit is re-checked when it is deleted.
    const roots = await db
      .select({ id: document.id, trashedAt: document.trashedAt })
      .from(document)
      .where(
        and(
          eligibleRoot,
          cursor ? after(cursor) : undefined,
          atOrBefore(bound),
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
      const inspected = await inspectRetentionUnit(
        db,
        root.id,
        itemsByRoot.get(root.id) ?? [],
        {
          cutoff: options.cutoff,
          maxGroups: options.maxGroups,
          deadlineAt: planningDeadline,
        },
      );
      if (inspected.kind === "out-of-time") return result(false);
      stoppedAt = { trashedAt: root.trashedAt, id: root.id };
      if (inspected.kind === "over-budget") {
        skipped[root.id] = OVER_BUDGET_REASON;
        continue;
      }
      if (inspected.kind === "blocked") continue;
      const { unit } = inspected;
      if (
        unit.items.some((item) => chosenAdjacentIds.has(item.id)) ||
        [...unit.adjacentDocumentIds].some((id) => chosenDocumentIds.has(id))
      ) {
        continue;
      }
      chosen.push(unit);
      for (const item of unit.items) chosenDocumentIds.add(item.id);
      for (const id of unit.adjacentDocumentIds) chosenAdjacentIds.add(id);
    }
    if (roots.length < options.pageSize || stoppedAt?.id === bound.id) {
      return result(true);
    }
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
    skipped: Record<string, string>;
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
    ...(Object.keys(options.skipped).length > 0
      ? { skipped: options.skipped }
      : {}),
  };
  const operations = schema.contentTrashPurgeOperations;
  await db.transaction(async (tx) => {
    const setting = await lockContentTrashRetentionState(
      tx as unknown as Db,
      "exclusive",
    );
    if (setting?.startedAt !== options.startedAt) {
      throw new RetentionRunClaimedElsewhereError();
    }
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
  protectionBudget?: number;
  idleRearmMs?: number;
  dispatch?: (operationId: string) => Promise<void>;
}): Promise<ContentTrashRetentionRun> {
  const db = getDb();
  const now = options.now ?? new Date();
  const dispatch = options.dispatch ?? dispatchContentTrashPurge;
  const sweep = await recordContentTrashRetentionSweep(
    db,
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
      cancelledOperationIds: sweep.cancelledOperationIds,
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
  const { units, scan, skipped } = await findContentTrashRetentionUnits(db, {
    cutoff,
    deadlineAt: options.deadlineAt,
    maxUnits: options.maxUnits ?? MAX_UNITS,
    pageSize: options.scanPageSize ?? ROOT_PAGE_SIZE,
    maxPages: options.scanPages ?? MAX_ROOT_PAGES,
    maxGroups:
      options.protectionBudget ?? CONTENT_TRASH_PROTECTION_GROUP_BUDGET,
    pass: await latestScanPass(db),
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
      skipped,
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
