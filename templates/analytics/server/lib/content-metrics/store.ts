import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, gt, lt, sql } from "drizzle-orm";

import { getDb, schema } from "../../db/index.js";
import {
  contentCollectionConfigSchema,
  contentTenantKey,
  defaultContentCollectionConfig,
  type ContentCollectionConfig,
  type ContentCollectionScope,
  type ContentCollectionStepId,
} from "./config.js";

/**
 * A run still "running" after this long was cut off (a timed-out function or
 * a restarted server). It is closed as failed so it never poses as in flight.
 */
export const CONTENT_RUN_STALE_AFTER_MS = 30 * 60 * 1000;

/** Rows per insert statement, well under Postgres' bind-parameter limit. */
const WRITE_BATCH_SIZE = 500;

export type ContentRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cost_limited"
  | "not_configured";

export type ContentRunTrigger = "scheduled" | "manual";

export type ContentCollection = ContentCollectionScope & {
  tenantKey: string;
  enabled: boolean;
  config: ContentCollectionConfig;
};

export type ContentItemInput = {
  source: ContentCollectionStepId;
  externalId: string;
  url: string | null;
  title: string | null;
  author: string | null;
  authors: string[];
  publishedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ContentSnapshotInput = {
  /** The item's source and id; the snapshot's own `source` is the step that collected it. */
  itemSource: ContentCollectionStepId;
  itemExternalId: string;
  metricDate: string;
  metric: string;
  value: number;
};

export type ContentRunOutcome = {
  rowCount: number;
  windowStart?: string | null;
  windowEnd?: string | null;
  configFingerprint?: string | null;
  bytesProcessed?: number | null;
  bytesCap?: number | null;
  costUsd?: number | null;
};

export type ContentRunFailure = {
  status: Exclude<ContentRunStatus, "running" | "succeeded">;
  errorCode: string;
  errorMessage: string;
  bytesProcessed?: number | null;
  bytesCap?: number | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toCollection(
  row: typeof schema.analyticsContentCollections.$inferSelect,
): ContentCollection {
  const parsed = contentCollectionConfigSchema.safeParse(
    JSON.parse(row.config),
  );
  if (!parsed.success) {
    // Only configure-content-collection writes this column, so a mismatch
    // means it was edited by hand. Collecting with a guessed config would
    // record runs nobody asked for.
    throw new Error(
      `Content collection config for ${row.tenantKey} is unreadable: ${parsed.error.message}`,
    );
  }
  return {
    tenantKey: row.tenantKey,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    enabled: row.enabled,
    config: parsed.data,
  };
}

export async function readContentCollection(
  scope: ContentCollectionScope,
): Promise<ContentCollection | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.analyticsContentCollections)
    .where(
      eq(schema.analyticsContentCollections.tenantKey, contentTenantKey(scope)),
    )
    .limit(1);
  return row ? toCollection(row) : null;
}

export async function writeContentCollection(
  scope: ContentCollectionScope,
  update: { enabled: boolean; config?: ContentCollectionConfig },
): Promise<ContentCollection> {
  const db = getDb();
  const tenantKey = contentTenantKey(scope);
  const config = update.config ?? defaultContentCollectionConfig();
  const timestamp = nowIso();
  await db
    .insert(schema.analyticsContentCollections)
    .values({
      tenantKey,
      ownerEmail: scope.ownerEmail.trim().toLowerCase(),
      orgId: scope.orgId,
      enabled: update.enabled,
      config: JSON.stringify(config),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: schema.analyticsContentCollections.tenantKey,
      set: {
        ownerEmail: scope.ownerEmail.trim().toLowerCase(),
        enabled: update.enabled,
        ...(update.config ? { config: JSON.stringify(update.config) } : {}),
        updatedAt: timestamp,
      },
    });
  const saved = await readContentCollection(scope);
  if (!saved) {
    throw new Error(`Content collection ${tenantKey} was not saved.`);
  }
  return saved;
}

export async function listEnabledContentCollections(
  afterTenantKey?: string,
): Promise<ContentCollection[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.analyticsContentCollections)
    .where(
      and(
        eq(schema.analyticsContentCollections.enabled, true),
        afterTenantKey === undefined
          ? undefined
          : gt(schema.analyticsContentCollections.tenantKey, afterTenantKey),
      ),
    )
    .orderBy(schema.analyticsContentCollections.tenantKey)
    .limit(1000);
  return rows.map(toCollection);
}

export async function closeStaleContentRuns(now = new Date()): Promise<number> {
  const db = getDb();
  const cutoff = new Date(
    now.getTime() - CONTENT_RUN_STALE_AFTER_MS,
  ).toISOString();
  const closed = await db
    .update(schema.analyticsContentCollectionRuns)
    .set({
      status: "failed",
      finishedAt: now.toISOString(),
      errorCode: "abandoned",
      errorMessage:
        "The run stopped before it finished (the server restarted or timed out).",
    })
    .where(
      and(
        eq(schema.analyticsContentCollectionRuns.status, "running"),
        lt(schema.analyticsContentCollectionRuns.startedAt, cutoff),
      ),
    )
    .returning({ id: schema.analyticsContentCollectionRuns.id });
  return closed.length;
}

export async function latestContentRun(
  collection: ContentCollection,
  step: ContentCollectionStepId,
): Promise<typeof schema.analyticsContentCollectionRuns.$inferSelect | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.analyticsContentCollectionRuns)
    .where(
      and(
        eq(
          schema.analyticsContentCollectionRuns.tenantKey,
          collection.tenantKey,
        ),
        eq(schema.analyticsContentCollectionRuns.step, step),
      ),
    )
    .orderBy(desc(schema.analyticsContentCollectionRuns.startedAt))
    .limit(1);
  return row ?? null;
}

/** The last run of a step that wrote its data, for choosing a backfill window. */
export async function lastSucceededContentRun(
  collection: ContentCollection,
  step: ContentCollectionStepId,
): Promise<typeof schema.analyticsContentCollectionRuns.$inferSelect | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.analyticsContentCollectionRuns)
    .where(
      and(
        eq(
          schema.analyticsContentCollectionRuns.tenantKey,
          collection.tenantKey,
        ),
        eq(schema.analyticsContentCollectionRuns.step, step),
        eq(schema.analyticsContentCollectionRuns.status, "succeeded"),
      ),
    )
    .orderBy(desc(schema.analyticsContentCollectionRuns.startedAt))
    .limit(1);
  return row ?? null;
}

export type StoredContentItem = {
  source: ContentCollectionStepId;
  externalId: string;
  url: string | null;
  publishedAt: string | null;
};

/** More items than this from one source is a runaway collection, not a site. */
export const CONTENT_ITEMS_PER_SOURCE_LIMIT = 50_000;

export async function listContentItems(
  collection: ContentCollection,
  source: ContentCollectionStepId,
): Promise<StoredContentItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      externalId: schema.analyticsContentItems.externalId,
      url: schema.analyticsContentItems.url,
      publishedAt: schema.analyticsContentItems.publishedAt,
    })
    .from(schema.analyticsContentItems)
    .where(
      and(
        eq(schema.analyticsContentItems.tenantKey, collection.tenantKey),
        eq(schema.analyticsContentItems.source, source),
      ),
    )
    .limit(CONTENT_ITEMS_PER_SOURCE_LIMIT + 1);
  if (rows.length > CONTENT_ITEMS_PER_SOURCE_LIMIT) {
    throw new Error(
      `More than ${CONTENT_ITEMS_PER_SOURCE_LIMIT} ${source} content items; refusing a partial read.`,
    );
  }
  return rows.map((row: Omit<StoredContentItem, "source">) => ({
    ...row,
    source,
  }));
}

export async function startContentRun(
  collection: ContentCollection,
  step: ContentCollectionStepId,
  trigger: ContentRunTrigger,
  now = new Date(),
): Promise<
  { runId: string; reason?: never } | { runId?: never; reason: string }
> {
  return getDb().transaction(async (tx) => {
    // Lock the stable tenant row, including when this step has no runs yet.
    const [owner] = await tx
      .select({ tenantKey: schema.analyticsContentCollections.tenantKey })
      .from(schema.analyticsContentCollections)
      .where(
        eq(schema.analyticsContentCollections.tenantKey, collection.tenantKey),
      )
      .limit(1)
      .for("update");
    if (!owner) throw new Error("Content collection no longer exists.");
    const scope = and(
      eq(schema.analyticsContentCollectionRuns.tenantKey, collection.tenantKey),
      eq(schema.analyticsContentCollectionRuns.step, step),
    );
    await tx
      .update(schema.analyticsContentCollectionRuns)
      .set({
        status: "failed",
        finishedAt: now.toISOString(),
        errorCode: "abandoned",
        errorMessage:
          "The run stopped before it finished (the server restarted or timed out).",
      })
      .where(
        and(
          scope,
          eq(schema.analyticsContentCollectionRuns.status, "running"),
          lt(
            schema.analyticsContentCollectionRuns.startedAt,
            new Date(now.getTime() - CONTENT_RUN_STALE_AFTER_MS).toISOString(),
          ),
        ),
      );
    const [active] = await tx
      .select({ id: schema.analyticsContentCollectionRuns.id })
      .from(schema.analyticsContentCollectionRuns)
      .where(
        and(scope, eq(schema.analyticsContentCollectionRuns.status, "running")),
      )
      .limit(1);
    if (active) return { reason: "already_running" };
    const [latest] = await tx
      .select()
      .from(schema.analyticsContentCollectionRuns)
      .where(scope)
      .orderBy(desc(schema.analyticsContentCollectionRuns.startedAt))
      .limit(1);
    if (
      trigger === "scheduled" &&
      latest?.startedAt.slice(0, 10) === now.toISOString().slice(0, 10) &&
      (latest.status === "succeeded" || latest.status === "cost_limited")
    ) {
      return { reason: "already_ran_today" };
    }
    const id = `ccr_${randomUUID()}`;
    await tx.insert(schema.analyticsContentCollectionRuns).values({
      id,
      tenantKey: collection.tenantKey,
      ownerEmail: collection.ownerEmail,
      orgId: collection.orgId,
      step,
      trigger,
      status: "running",
      startedAt: now.toISOString(),
    });
    return { runId: id };
  });
}

export async function failContentRun(
  runId: string,
  failure: ContentRunFailure,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.analyticsContentCollectionRuns)
    .set({
      status: failure.status,
      finishedAt: nowIso(),
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage.slice(0, 2000),
      bytesProcessed: failure.bytesProcessed ?? null,
      bytesCap: failure.bytesCap ?? null,
    })
    .where(eq(schema.analyticsContentCollectionRuns.id, runId));
}

function itemId(tenantKey: string, source: string, externalId: string) {
  const digest = createHash("sha256")
    .update(`${tenantKey}\u0000${source}\u0000${externalId}`)
    .digest("base64url");
  return `cci_${digest}`;
}

/**
 * Writes a succeeded step's items and snapshots and marks its run succeeded
 * in one transaction, so a run is never "succeeded" without its data and no
 * data lands under a run that then fails.
 */
export async function completeContentRun(
  collection: ContentCollection,
  runId: string,
  step: ContentCollectionStepId,
  data: {
    items?: ContentItemInput[];
    snapshots?: ContentSnapshotInput[];
  },
  outcome: ContentRunOutcome,
): Promise<void> {
  const db = getDb();
  const timestamp = nowIso();
  const items = data.items ?? [];
  const snapshots = data.snapshots ?? [];

  await db.transaction(async (tx: any) => {
    for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
      const batch = items
        .slice(start, start + WRITE_BATCH_SIZE)
        .map((item) => ({
          id: itemId(collection.tenantKey, item.source, item.externalId),
          tenantKey: collection.tenantKey,
          ownerEmail: collection.ownerEmail,
          orgId: collection.orgId,
          source: item.source,
          externalId: item.externalId,
          url: item.url,
          title: item.title,
          author: item.author,
          authors: JSON.stringify(item.authors),
          publishedAt: item.publishedAt,
          metadata: JSON.stringify(item.metadata),
          firstSeenAt: timestamp,
          updatedAt: timestamp,
        }));
      await tx
        .insert(schema.analyticsContentItems)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            schema.analyticsContentItems.tenantKey,
            schema.analyticsContentItems.source,
            schema.analyticsContentItems.externalId,
          ],
          set: {
            url: sql`excluded.url`,
            title: sql`excluded.title`,
            author: sql`excluded.author`,
            authors: sql`excluded.authors`,
            publishedAt: sql`excluded.published_at`,
            metadata: sql`excluded.metadata`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }

    for (let start = 0; start < snapshots.length; start += WRITE_BATCH_SIZE) {
      const batch = snapshots
        .slice(start, start + WRITE_BATCH_SIZE)
        .map((snapshot) => {
          const item = itemId(
            collection.tenantKey,
            snapshot.itemSource,
            snapshot.itemExternalId,
          );
          return {
            id: `ccs_${randomUUID()}`,
            tenantKey: collection.tenantKey,
            ownerEmail: collection.ownerEmail,
            orgId: collection.orgId,
            itemId: item,
            metricDate: snapshot.metricDate,
            metric: snapshot.metric,
            value: snapshot.value,
            source: step,
            runId,
            collectedAt: timestamp,
          };
        });
      await tx
        .insert(schema.analyticsContentMetricSnapshots)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            schema.analyticsContentMetricSnapshots.tenantKey,
            schema.analyticsContentMetricSnapshots.itemId,
            schema.analyticsContentMetricSnapshots.metricDate,
            schema.analyticsContentMetricSnapshots.metric,
          ],
          set: {
            value: sql`excluded.value`,
            source: sql`excluded.source`,
            runId: sql`excluded.run_id`,
            collectedAt: sql`excluded.collected_at`,
          },
          // Steps re-send whole windows (signups recomputes 90 days daily),
          // so an unchanged value writes nothing and keeps the run that set it.
          setWhere: sql`${schema.analyticsContentMetricSnapshots.value} IS DISTINCT FROM excluded.value OR ${schema.analyticsContentMetricSnapshots.source} IS DISTINCT FROM excluded.source`,
        });
    }

    await tx
      .update(schema.analyticsContentCollectionRuns)
      .set({
        status: "succeeded",
        finishedAt: nowIso(),
        rowCount: outcome.rowCount,
        windowStart: outcome.windowStart ?? null,
        windowEnd: outcome.windowEnd ?? null,
        configFingerprint: outcome.configFingerprint ?? null,
        bytesProcessed: outcome.bytesProcessed ?? null,
        bytesCap: outcome.bytesCap ?? null,
        costUsd: outcome.costUsd ?? null,
      })
      .where(eq(schema.analyticsContentCollectionRuns.id, runId));
  });
}
