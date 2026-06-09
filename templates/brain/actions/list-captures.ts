import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import {
  latestDistillationQueuesForCaptures,
  parseJson,
  sourceUrlFromMetadataRecord,
} from "../server/lib/brain.js";
import { redactSensitiveText } from "../server/lib/search.js";
import { captureKindSchema, sourceProviderSchema } from "./_schemas.js";

const captureStatusSchema = z.enum([
  "queued",
  "distilling",
  "distilled",
  "ignored",
]);

const booleanFlagSchema = z
  .preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean())
  .default(false);

function contentPreview(content: string, maxLength: number) {
  const text = redactSensitiveText(content).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function redactOptionalText(value: string | null) {
  return value ? redactSensitiveText(value) : value;
}

function redactDistillationQueue<T extends { error: string | null }>(
  queue: T | null,
): T | null {
  if (!queue) return null;
  return {
    ...queue,
    error: redactOptionalText(queue.error),
  };
}

export default defineAction({
  description:
    "List raw Brain captures for review without returning raw content by default. Use get-capture to open one accessible capture when needed.",
  schema: z.object({
    sourceId: z.string().optional(),
    provider: sourceProviderSchema.optional(),
    status: captureStatusSchema.optional(),
    kind: captureKindSchema.optional(),
    includeArchivedSources: booleanFlagSchema,
    includePreview: booleanFlagSchema.describe(
      "When true, include a short text preview for human review.",
    ),
    previewLength: z.coerce.number().int().min(80).max(500).default(220),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const sourceRows = [];
    if (args.sourceId) {
      const access = await resolveAccess("brain-source", args.sourceId);
      if (!access) return { count: 0, captures: [] };
      sourceRows.push(access.resource);
    } else {
      const sourceClauses = [
        accessFilter(schema.brainSources, schema.brainSourceShares),
      ];
      if (args.provider) {
        sourceClauses.push(eq(schema.brainSources.provider, args.provider));
      }
      if (!args.includeArchivedSources) {
        sourceClauses.push(eq(schema.brainSources.status, "active"));
      }
      sourceRows.push(
        ...(await db
          .select()
          .from(schema.brainSources)
          .where(and(...sourceClauses))
          .limit(250)),
      );
    }

    const sourceIds = sourceRows.map((source) => source.id);
    if (!sourceIds.length) return { count: 0, captures: [] };
    const sourceMap = new Map(sourceRows.map((source) => [source.id, source]));
    const captureClauses = [
      inArray(schema.brainRawCaptures.sourceId, sourceIds),
    ];
    if (args.status) {
      captureClauses.push(eq(schema.brainRawCaptures.status, args.status));
    }
    if (args.kind) {
      captureClauses.push(eq(schema.brainRawCaptures.kind, args.kind));
    }

    // Project only the columns the list path uses. The heavy `content` blob is
    // never fetched unless a preview was explicitly requested, and even then we
    // pull only a truncated slice via substr (portable across Postgres and
    // SQLite, both 1-indexed). `contentPreview` collapses whitespace, so we
    // over-fetch a margin so the trimmed preview still reaches previewLength.
    const previewSliceLength = args.includePreview
      ? Math.min(args.previewLength * 4, 4000)
      : 0;
    const rows = await db
      .select({
        id: schema.brainRawCaptures.id,
        sourceId: schema.brainRawCaptures.sourceId,
        externalId: schema.brainRawCaptures.externalId,
        title: schema.brainRawCaptures.title,
        kind: schema.brainRawCaptures.kind,
        status: schema.brainRawCaptures.status,
        capturedAt: schema.brainRawCaptures.capturedAt,
        metadataJson: schema.brainRawCaptures.metadataJson,
        createdAt: schema.brainRawCaptures.createdAt,
        updatedAt: schema.brainRawCaptures.updatedAt,
        ...(args.includePreview
          ? {
              contentPreviewRaw: sql<string>`substr(${schema.brainRawCaptures.content}, 1, ${previewSliceLength})`,
            }
          : {}),
      })
      .from(schema.brainRawCaptures)
      .where(and(...captureClauses))
      .orderBy(desc(schema.brainRawCaptures.capturedAt))
      .limit(args.limit);
    const queueByCapture = await latestDistillationQueuesForCaptures(
      rows.map((row) => row.id),
    );

    return {
      count: rows.length,
      captures: rows.flatMap((row) => {
        const source = sourceMap.get(row.sourceId);
        if (!source) return [];
        const metadata = parseJson<Record<string, unknown>>(
          row.metadataJson,
          {},
        );
        return [
          {
            id: row.id,
            sourceId: row.sourceId,
            source: {
              id: source.id,
              title: redactSensitiveText(source.title),
              provider: source.provider,
              status: source.status,
            },
            externalId: redactOptionalText(row.externalId),
            title: redactSensitiveText(row.title),
            kind: row.kind,
            status: row.status,
            capturedAt: row.capturedAt,
            sourceUrl: sourceUrlFromMetadataRecord(metadata),
            distillationQueue: redactDistillationQueue(
              queueByCapture.get(row.id) ?? null,
            ),
            preview:
              args.includePreview && "contentPreviewRaw" in row
                ? contentPreview(row.contentPreviewRaw, args.previewLength)
                : undefined,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        ];
      }),
    };
  },
});
