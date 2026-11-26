import { randomBytes, randomUUID } from "node:crypto";

import { getSettingEntry, mutateSetting } from "@agent-native/core/settings";
import { and, asc, eq, gt, inArray, isNotNull, lte, or } from "drizzle-orm";

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
  dispatchContentTrashPurge,
  hashTrashScopeToken,
} from "./content-trash-purge.js";
import { firstRow } from "./first-row.js";

export const CONTENT_TRASH_RETENTION_SWEEP_ID = "content-trash-retention";
export const CONTENT_TRASH_RETENTION_SETTING_KEY = "content-trash-retention";
const MAX_UNITS = 200;
const STALLED_MS = 2 * 60 * 1000;
const ROOT_PAGE_SIZE = 100;
const MAX_ROOT_PAGES = 10;
const PLANNING_RESERVE_MS = 15_000;
const PLAN_ITEM_INSERT_CHUNK = 500;

type Db = ReturnType<typeof getDb>;

type RetentionItem = {
  id: string;
  rootId: string;
  title: string;
  ownerEmail: string;
  parentId: string | null;
  spaceId: string | null;
  trashedAt: string;
  sourceMode: string | null;
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

function parseRetentionStart(value: unknown): string {
  const startedAt =
    value && typeof value === "object" && "startedAt" in value
      ? value.startedAt
      : undefined;
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) {
    throw new Error(
      `Setting "${CONTENT_TRASH_RETENTION_SETTING_KEY}" has no valid startedAt; automatic Trash deletion will not run until it is repaired.`,
    );
  }
  return startedAt;
}

export async function readContentTrashRetention(): Promise<ContentTrashRetention> {
  const entry = await getSettingEntry(CONTENT_TRASH_RETENTION_SETTING_KEY, {
    bypassCache: true,
  });
  const startedAt = entry.found ? parseRetentionStart(entry.value) : null;
  return {
    retentionDays: CONTENT_TRASH_RETENTION_DAYS,
    startedAt,
    deletionsBeginAt: startedAt
      ? contentTrashRetentionDeletionsBeginAt(startedAt)
      : null,
  };
}

export async function ensureContentTrashRetentionStart(
  now: Date,
): Promise<string> {
  const stored = await mutateSetting(
    CONTENT_TRASH_RETENTION_SETTING_KEY,
    (current) => current ?? { startedAt: now.toISOString() },
    { validateStoredValue: (value) => void parseRetentionStart(value) },
  );
  return parseRetentionStart(stored);
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
  cutoff: string,
): Promise<RetentionUnit | null> {
  const ownerEmail = items[0]?.ownerEmail;
  if (
    !ownerEmail ||
    !items.some((item) => item.id === rootId) ||
    items.some(
      (item) =>
        item.ownerEmail !== ownerEmail ||
        item.trashedAt > cutoff ||
        item.sourceMode,
    )
  ) {
    return null;
  }
  const documentIds = items.map((item) => item.id);
  // guard:allow-unscoped — the collections hosted by Pages the system selected; Empty Trash blocks the same ones.
  const databases = await db
    .select({
      id: schema.contentDatabases.id,
      systemRole: schema.contentDatabases.systemRole,
    })
    .from(schema.contentDatabases)
    .where(inArray(schema.contentDatabases.documentId, documentIds));
  if (databases.some((database) => database.systemRole)) return null;
  const databaseIds = databases.map(({ id }) => id);
  if (databaseIds.length > 0) {
    // guard:allow-unscoped — a source-connected collection blocks its whole Trash root, whoever connected it.
    const source = firstRow(
      await db
        .select({ id: schema.contentDatabaseSources.id })
        .from(schema.contentDatabaseSources)
        .where(inArray(schema.contentDatabaseSources.databaseId, databaseIds))
        .limit(1),
    );
    if (source) return null;
  }
  const relationships = await inspectPermanentDeleteRelationships(
    db,
    documentIds,
    ownerEmail,
  );
  if (relationships.inaccessibleRelationship) return null;
  const hostedDatabaseIds = new Set(databaseIds);
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

async function findContentTrashRetentionUnits(
  db: Db,
  options: {
    cutoff: string;
    deadlineAt: number;
    maxUnits: number;
    signal?: AbortSignal | undefined;
  },
): Promise<RetentionUnit[]> {
  const chosen: RetentionUnit[] = [];
  const chosenDocumentIds = new Set<string>();
  const chosenAdjacentIds = new Set<string>();
  const document = schema.documents;
  let cursor: { trashedAt: string; id: string } | undefined;
  for (let page = 0; page < MAX_ROOT_PAGES; page += 1) {
    if (Date.now() > options.deadlineAt - PLANNING_RESERVE_MS) break;
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
      .limit(ROOT_PAGE_SIZE);
    const last = firstRow(roots.slice(-1));
    if (!last?.trashedAt) break;
    cursor = { trashedAt: last.trashedAt, id: last.id };
    // guard:allow-unscoped — the Pages trashed with the system-selected roots above.
    const members = await db
      .select({
        id: document.id,
        rootId: document.trashRootId,
        title: document.title,
        ownerEmail: document.ownerEmail,
        parentId: document.parentId,
        spaceId: document.spaceId,
        trashedAt: document.trashedAt,
        sourceMode: document.sourceMode,
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
      );
    const itemsByRoot = new Map<string, RetentionItem[]>();
    for (const member of members) {
      if (!member.rootId || !member.trashedAt) continue;
      const items = itemsByRoot.get(member.rootId) ?? [];
      items.push({
        ...member,
        rootId: member.rootId,
        trashedAt: member.trashedAt,
      });
      itemsByRoot.set(member.rootId, items);
    }
    for (const root of roots) {
      if (chosen.length >= options.maxUnits) return chosen;
      if (Date.now() > options.deadlineAt - PLANNING_RESERVE_MS) return chosen;
      options.signal?.throwIfAborted();
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
    if (roots.length < ROOT_PAGE_SIZE) break;
  }
  return chosen;
}

async function startRetentionOperation(
  db: Db,
  options: {
    idempotencyKey: string;
    cutoff: string;
    startedAt: string;
    units: RetentionUnit[];
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
  await db.transaction(async (tx) => {
    const claimedRows = await tx
      .insert(schema.contentTrashPurgeOperations)
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
        target: [
          schema.contentTrashPurgeOperations.actorEmail,
          schema.contentTrashPurgeOperations.idempotencyKey,
        ],
      })
      .returning({ id: schema.contentTrashPurgeOperations.id });
    const claimed = firstRow(claimedRows);
    if (!claimed) throw new RetentionRunClaimedElsewhereError();
    await tx.insert(schema.contentTrashPurgePlans).values({
      id: planId,
      actorEmail: CONTENT_TRASH_RETENTION_ACTOR,
      orgId: null,
      mode: CONTENT_TRASH_RETENTION_PLAN_MODE,
      spaceId: null,
      filtersJson: JSON.stringify({
        cutoff: options.cutoff,
        startedAt: options.startedAt,
      }),
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
  dispatch?: (operationId: string) => Promise<void>;
}): Promise<ContentTrashRetentionRun> {
  const db = getDb();
  const now = options.now ?? new Date();
  const dispatch = options.dispatch ?? dispatchContentTrashPurge;
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
        inArray(operations.status, ["queued", "running", "retryable"]),
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

  const startedAt = await ensureContentTrashRetentionStart(now);
  const deletionsBeginAt = contentTrashRetentionDeletionsBeginAt(startedAt);
  if (deletionsBeginAt > now.toISOString()) {
    return { outcome: "waiting", deletionsBeginAt };
  }
  const cutoff = new Date(
    now.getTime() - CONTENT_TRASH_RETENTION_MS,
  ).toISOString();
  const units = await findContentTrashRetentionUnits(db, {
    cutoff,
    deadlineAt: options.deadlineAt,
    maxUnits: options.maxUnits ?? MAX_UNITS,
    signal: options.signal,
  });
  let started: Awaited<ReturnType<typeof startRetentionOperation>>;
  try {
    started = await startRetentionOperation(db, {
      idempotencyKey,
      cutoff,
      startedAt,
      units,
    });
  } catch (error) {
    if (error instanceof RetentionRunClaimedElsewhereError) {
      return { outcome: "claimed-elsewhere" };
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
