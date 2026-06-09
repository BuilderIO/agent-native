import { defineAction } from "@agent-native/core";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { parseJson, serializeSource } from "../server/lib/brain.js";
import { nextBrainSourceSyncAt } from "../server/jobs/sync-sources.js";
import { sourceProviderSchema } from "./_schemas.js";

async function sourceRecordCount(sourceId: string): Promise<number> {
  // Count only — never load the heavy `content` blob of every capture row
  // just to take `.length`.
  const [row] = await getDb()
    .select({ value: count() })
    .from(schema.brainRawCaptures)
    .where(eq(schema.brainRawCaptures.sourceId, sourceId));
  return row?.value ?? 0;
}

async function latestRun(sourceId: string) {
  const [run] = await getDb()
    .select()
    .from(schema.brainSyncRuns)
    .where(eq(schema.brainSyncRuns.sourceId, sourceId))
    .orderBy(desc(schema.brainSyncRuns.startedAt))
    .limit(1);
  return run
    ? {
        id: run.id,
        status: run.status,
        stats: parseJson(run.statsJson, {}),
        error: run.error,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      }
    : null;
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
    const sources = await Promise.all(
      rows.map(async (row) => ({
        ...serializeSource(row),
        recordCount: await sourceRecordCount(row.id),
        latestRun: await latestRun(row.id),
        nextSyncAt: nextBrainSourceSyncAt(row),
      })),
    );
    return { count: rows.length, sources };
  },
});
