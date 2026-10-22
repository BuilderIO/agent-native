import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  countDistinct,
  desc,
  eq,
  inArray,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nextBrainSourceSyncAt } from "../server/jobs/sync-sources.js";
import { listAccessibleAudienceIdsBySource } from "../server/lib/audiences.js";
import { sourceHealthState } from "../server/lib/brain-health.js";
import { parseJson, serializeSource } from "../server/lib/brain.js";
import { sourceProviderSchema } from "./_schemas.js";

async function sourceRecordCounts(sourceIds: string[]) {
  if (!sourceIds.length) return new Map<string, number>();
  const audiencesBySource = await listAccessibleAudienceIdsBySource(sourceIds);
  const sourceAudienceFilters = Array.from(
    audiencesBySource,
    ([sourceId, audienceIds]) =>
      and(
        eq(schema.brainRawCaptures.sourceId, sourceId),
        inArray(schema.brainCaptureAudiences.audienceId, audienceIds),
      ),
  );
  if (!sourceAudienceFilters.length) return new Map<string, number>();

  const rows = await getDb()
    .select({
      sourceId: schema.brainRawCaptures.sourceId,
      value: countDistinct(schema.brainRawCaptures.id),
    })
    .from(schema.brainRawCaptures)
    .innerJoin(
      schema.brainCaptureAudiences,
      eq(schema.brainCaptureAudiences.captureId, schema.brainRawCaptures.id),
    )
    .where(
      and(
        eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
        or(...sourceAudienceFilters),
      ),
    )
    .groupBy(schema.brainRawCaptures.sourceId);
  return new Map(rows.map((row) => [row.sourceId, row.value]));
}

async function latestRunsBySource(sourceIds: string[]) {
  if (!sourceIds.length) return new Map();
  const latestRun = getDb()
    .select({
      id: schema.brainSyncRuns.id,
      status: schema.brainSyncRuns.status,
      statsJson: schema.brainSyncRuns.statsJson,
      error: schema.brainSyncRuns.error,
      startedAt: schema.brainSyncRuns.startedAt,
      completedAt: schema.brainSyncRuns.completedAt,
    })
    .from(schema.brainSyncRuns)
    .where(eq(schema.brainSyncRuns.sourceId, schema.brainSources.id))
    .orderBy(desc(schema.brainSyncRuns.startedAt))
    .limit(1)
    .as("latest_run");
  const rows = await getDb()
    .select({
      sourceId: schema.brainSources.id,
      id: latestRun.id,
      status: latestRun.status,
      statsJson: latestRun.statsJson,
      error: latestRun.error,
      startedAt: latestRun.startedAt,
      completedAt: latestRun.completedAt,
    })
    .from(schema.brainSources)
    .leftJoinLateral(latestRun, sql`true`)
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        inArray(schema.brainSources.id, sourceIds),
      ),
    );
  const latestRuns = new Map<
    string,
    {
      id: string;
      status: NonNullable<typeof schema.brainSyncRuns.$inferSelect.status>;
      stats: ReturnType<typeof parseJson>;
      error: string | null;
      startedAt: string;
      completedAt: string | null;
    }
  >();
  for (const run of rows) {
    if (run.id === null || run.status === null || run.startedAt === null) {
      continue;
    }
    latestRuns.set(run.sourceId, {
      id: run.id,
      status: run.status,
      stats: parseJson(run.statsJson, {}),
      error: run.error,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    });
  }
  return latestRuns;
}

export default defineAction({
  description: "List Brain sources accessible to the current user.",
  schema: z.object({
    provider: sourceProviderSchema.optional(),
    includeArchived: z.coerce.boolean().default(false),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ provider, includeArchived }) => {
    const clauses = [
      accessFilter(schema.brainSources, schema.brainSourceShares),
    ];
    if (provider) clauses.push(eq(schema.brainSources.provider, provider));
    if (!includeArchived)
      clauses.push(ne(schema.brainSources.status, "archived"));
    const rows = await getDb()
      .select()
      .from(schema.brainSources)
      .where(and(...clauses))
      .orderBy(desc(schema.brainSources.updatedAt));
    const sourceIds = rows.map((row) => row.id);
    const [recordCounts, latestRuns] = await Promise.all([
      sourceRecordCounts(sourceIds),
      latestRunsBySource(sourceIds),
    ]);
    const nowMs = Date.now();
    const sources = rows.map((row) => {
      const latest = latestRuns.get(row.id) ?? null;
      const nextSyncAt = nextBrainSourceSyncAt(row);
      return {
        ...serializeSource(row),
        recordCount: recordCounts.get(row.id) ?? 0,
        latestRun: latest,
        nextSyncAt,
        health: sourceHealthState(row, latest, nextSyncAt, nowMs),
      };
    });
    return {
      count: rows.length,
      sources,
    };
  },
});
