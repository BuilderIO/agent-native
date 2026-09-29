import { defineAction } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, gt, inArray, isNotNull, lte, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso } from "../server/lib/brain.js";
import { enqueueBrainOperation } from "../server/lib/ingest-queue.js";
import { BRAIN_SEARCH_INDEX_VERSION } from "../server/lib/search-index-contracts.js";
import {
  readCaptureEmbeddingCoverage,
  readEmbeddingReadiness,
} from "../server/lib/search-index.js";
import { redactSensitiveText } from "../server/lib/search.js";
import {
  booleanishSchema,
  idSchema,
  stringArrayCliSchema,
} from "./_schemas.js";

export const backfillSearchEmbeddingsSchema = z
  .object({
    sourceId: idSchema,
    dryRun: booleanishSchema.default(true),
    force: booleanishSchema.default(false),
    captureIds: stringArrayCliSchema({ min: 1, max: 50 }).optional(),
    afterUpdatedAt: z.string().datetime().optional(),
    afterCaptureId: idSchema.optional(),
    throughUpdatedAt: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .refine(
    (args) => Boolean(args.afterUpdatedAt) === Boolean(args.afterCaptureId),
    {
      message: "Provide afterUpdatedAt and afterCaptureId together.",
    },
  )
  .refine(
    (args) =>
      !args.captureIds?.length ||
      (!args.afterUpdatedAt && !args.afterCaptureId && !args.throughUpdatedAt),
    {
      message: "captureIds cannot be combined with pagination cursors.",
    },
  );

type CandidateRow = Awaited<
  ReturnType<typeof findCandidatePage>
>["rows"][number];

async function findCandidatePage(args: {
  sourceId: string;
  embeddingSetId: string | null;
  captureIds?: string[];
  afterUpdatedAt?: string;
  afterCaptureId?: string;
  throughUpdatedAt: string;
  limit: number;
}) {
  const rows = await getDb()
    .select({
      id: schema.brainRawCaptures.id,
      sourceId: schema.brainRawCaptures.sourceId,
      title: schema.brainRawCaptures.title,
      content: schema.brainRawCaptures.content,
      contentHash: schema.brainRawCaptures.contentHash,
      sensitivityDisposition: schema.brainRawCaptures.sensitivityDisposition,
      sensitivityPolicyVersion:
        schema.brainRawCaptures.sensitivityPolicyVersion,
      audienceAclHash: schema.brainRawCaptures.audienceAclHash,
      capturedAt: schema.brainRawCaptures.capturedAt,
      updatedAt: schema.brainRawCaptures.updatedAt,
      artifactId: schema.brainSearchArtifacts.id,
      artifactAudienceId: schema.brainSearchArtifacts.audienceId,
      artifactAclHash: schema.brainSearchArtifacts.aclHash,
      artifactTitle: schema.brainSearchArtifacts.title,
      artifactQuestion: schema.brainSearchArtifacts.question,
      artifactSummary: schema.brainSearchArtifacts.summary,
      artifactResolution: schema.brainSearchArtifacts.resolution,
      artifactSystemsJson: schema.brainSearchArtifacts.systemsJson,
      artifactCodeRefsJson: schema.brainSearchArtifacts.codeRefsJson,
      embeddingId: schema.brainSearchEmbeddings.id,
    })
    .from(schema.brainRawCaptures)
    .leftJoin(
      schema.brainSearchArtifacts,
      and(
        eq(schema.brainSearchArtifacts.captureId, schema.brainRawCaptures.id),
        eq(schema.brainSearchArtifacts.status, "active"),
        eq(
          schema.brainSearchArtifacts.contentHash,
          schema.brainRawCaptures.contentHash,
        ),
        eq(
          schema.brainSearchArtifacts.sensitivityPolicyVersion,
          schema.brainRawCaptures.sensitivityPolicyVersion,
        ),
        eq(
          schema.brainSearchArtifacts.aclHash,
          schema.brainRawCaptures.audienceAclHash,
        ),
        eq(
          schema.brainSearchArtifacts.indexVersion,
          BRAIN_SEARCH_INDEX_VERSION,
        ),
      ),
    )
    .leftJoin(
      schema.brainSearchEmbeddings,
      and(
        eq(schema.brainSearchEmbeddings.targetType, "artifact"),
        eq(
          schema.brainSearchEmbeddings.targetId,
          schema.brainSearchArtifacts.id,
        ),
        eq(schema.brainSearchEmbeddings.status, "active"),
        eq(
          schema.brainSearchEmbeddings.embeddingSetId,
          args.embeddingSetId ?? "__unconfigured__",
        ),
        eq(
          schema.brainSearchEmbeddings.contentHash,
          schema.brainRawCaptures.contentHash,
        ),
        eq(
          schema.brainSearchEmbeddings.sensitivityPolicyVersion,
          schema.brainRawCaptures.sensitivityPolicyVersion,
        ),
        eq(
          schema.brainSearchEmbeddings.aclHash,
          schema.brainRawCaptures.audienceAclHash,
        ),
        eq(
          schema.brainSearchEmbeddings.indexVersion,
          BRAIN_SEARCH_INDEX_VERSION,
        ),
      ),
    )
    .where(
      and(
        eq(schema.brainRawCaptures.sourceId, args.sourceId),
        eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
        isNotNull(schema.brainRawCaptures.contentHash),
        isNotNull(schema.brainRawCaptures.sensitivityPolicyVersion),
        isNotNull(schema.brainRawCaptures.audienceAclHash),
        args.captureIds?.length
          ? inArray(schema.brainRawCaptures.id, args.captureIds)
          : lte(schema.brainRawCaptures.updatedAt, args.throughUpdatedAt),
        args.afterUpdatedAt && args.afterCaptureId
          ? or(
              gt(schema.brainRawCaptures.updatedAt, args.afterUpdatedAt),
              and(
                eq(schema.brainRawCaptures.updatedAt, args.afterUpdatedAt),
                gt(schema.brainRawCaptures.id, args.afterCaptureId),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(schema.brainRawCaptures.updatedAt),
      asc(schema.brainRawCaptures.id),
    )
    .limit(
      args.captureIds?.length
        ? Math.min(50, args.captureIds.length)
        : args.limit + 1,
    );

  return {
    rows: rows.slice(0, args.captureIds?.length ?? args.limit),
    hasMore: !args.captureIds?.length && rows.length > args.limit,
  };
}

async function candidateReason(
  row: CandidateRow,
  force: boolean,
  embeddingSetId: string | null,
) {
  if (force) return "forced";
  if (!row.artifactId) return "missing-artifact";
  if (!row.embeddingId || !embeddingSetId) return "missing-embedding";
  const coverage = await readCaptureEmbeddingCoverage(row.id, embeddingSetId);
  return coverage.complete ? null : "partial-embedding";
}

async function enqueueCandidate(row: CandidateRow, embeddingSetId: string) {
  try {
    const queue = await enqueueBrainOperation({
      operation: "search-index",
      dedupeKey: `search-index-backfill:${row.id}:${row.contentHash}:${embeddingSetId}`,
      sourceId: row.sourceId,
      captureId: row.id,
      priority: 40,
      payload: { requiredEmbeddingSetId: embeddingSetId },
    });
    return {
      captureId: row.id,
      outcome: "queued" as const,
      queueId: queue?.id ?? null,
      reason: null,
    };
  } catch (error) {
    return {
      captureId: row.id,
      outcome: "failed" as const,
      queueId: null,
      reason: redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

async function readSourceEmbeddingReadiness(sourceId: string) {
  const [source] = await getDb()
    .select({
      ownerEmail: schema.brainSources.ownerEmail,
      orgId: schema.brainSources.orgId,
    })
    .from(schema.brainSources)
    .where(eq(schema.brainSources.id, sourceId))
    .limit(1);
  if (!source) throw new Error("Brain source was not found.");
  return runWithRequestContext(
    {
      userEmail: source.ownerEmail,
      orgId: source.orgId ?? undefined,
    },
    readEmbeddingReadiness,
  );
}

export function backfillSearchEmbeddingsNeedsApproval(args: {
  dryRun?: unknown;
}) {
  return !booleanishSchema.default(true).parse(args.dryRun);
}

export default defineAction({
  description:
    "Dry-run or durably queue semantic embedding backfills for a bounded page of allowed captures from one accessible Brain source.",
  schema: backfillSearchEmbeddingsSchema,
  needsApproval: backfillSearchEmbeddingsNeedsApproval,
  toolCallable: false,
  run: async (args) => {
    await assertAccess("brain-source", args.sourceId, "admin");
    const readiness = await readSourceEmbeddingReadiness(args.sourceId);
    if (!args.dryRun && !readiness.ready) {
      throw new Error(
        readiness.warning ??
          "Set up an embeddings provider before backfilling.",
      );
    }

    const throughUpdatedAt = args.throughUpdatedAt ?? nowIso();
    const page = await findCandidatePage({
      sourceId: args.sourceId,
      embeddingSetId: readiness.embeddingSetId,
      captureIds: args.captureIds,
      afterUpdatedAt: args.afterUpdatedAt,
      afterCaptureId: args.afterCaptureId,
      throughUpdatedAt,
      limit: args.limit,
    });
    const candidateRows = await Promise.all(
      page.rows.map(async (row) => ({
        row,
        reason: await candidateReason(
          row,
          args.force,
          readiness.embeddingSetId,
        ),
      })),
    );
    const candidates = candidateRows.filter(
      (candidate): candidate is typeof candidate & { reason: string } =>
        candidate.reason !== null,
    );
    const lastRow = page.rows[page.rows.length - 1];
    const nextCursor =
      page.hasMore && lastRow
        ? {
            afterUpdatedAt: lastRow.updatedAt,
            afterCaptureId: lastRow.id,
            throughUpdatedAt,
          }
        : null;

    if (args.dryRun) {
      return {
        dryRun: true,
        sourceId: args.sourceId,
        readiness,
        scanned: page.rows.length,
        matched: candidates.length,
        queued: 0,
        failed: 0,
        failedCaptureIds: [],
        hasMore: page.hasMore,
        nextCursor,
        candidates: candidates.map(({ row, reason }) => ({
          captureId: row.id,
          reason,
        })),
        results: [],
      };
    }

    const results = await Promise.all(
      candidates.map(({ row }) =>
        enqueueCandidate(row, readiness.embeddingSetId!),
      ),
    );
    return {
      dryRun: false,
      sourceId: args.sourceId,
      readiness,
      scanned: page.rows.length,
      matched: candidates.length,
      queued: results.filter((result) => result.outcome === "queued").length,
      failed: results.filter((result) => result.outcome === "failed").length,
      failedCaptureIds: results
        .filter((result) => result.outcome === "failed")
        .map((result) => result.captureId),
      hasMore: page.hasMore,
      nextCursor,
      candidates: candidates.map(({ row, reason }) => ({
        captureId: row.id,
        reason,
      })),
      results,
    };
  },
});
