import { defineAction } from "@agent-native/core/action";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listAccessibleAudienceIds } from "../server/lib/audiences.js";
import {
  latestDistillationQueuesForCaptures,
  sourceUrlFromMetadataRecord,
} from "../server/lib/brain.js";
import {
  publicCaptureTitle,
  publicSourceTitle,
} from "../server/lib/capture-sanitization.js";
import {
  parseCaptureMetadata,
  publicCaptureExternalId,
  readWithheldPassages,
  withOmissionReceipt,
  withheldPassageCount,
} from "../server/lib/search-index-contracts.js";
import { redactSensitiveText } from "../server/lib/search.js";
import { personalGoogleSourceFilter } from "../server/lib/source-access.js";
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

function previewRawFromRow(row: Record<string, unknown>): string {
  if (typeof row.contentPreviewRaw === "string") return row.contentPreviewRaw;
  if (typeof row.content === "string") return row.content;
  return "";
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
    captureId: z.string().optional(),
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
  mcpTool: "search",
  run: async (args) => {
    const db = getDb();
    const sourceRows = [];
    if (args.sourceId) {
      const access = await resolveAccess("brain-source", args.sourceId);
      if (!access) return { count: 0, captures: [] };
      sourceRows.push(access.resource);
    } else {
      const sourceClauses = [
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          personalGoogleSourceFilter(),
        ),
      ];
      if (args.captureId) {
        const captureRows = await db
          .select({ sourceId: schema.brainRawCaptures.sourceId })
          .from(schema.brainRawCaptures)
          .where(eq(schema.brainRawCaptures.id, args.captureId))
          .limit(1);
        const captureRow = captureRows.find((row) => row.sourceId);
        if (!captureRow) return { count: 0, captures: [] };
        sourceClauses.push(eq(schema.brainSources.id, captureRow.sourceId));
      }
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
    const audienceIds = await listAccessibleAudienceIds(sourceIds);
    if (!audienceIds.length) return { count: 0, captures: [] };
    const sourceMap = new Map(sourceRows.map((source) => [source.id, source]));
    const captureClauses = [
      inArray(schema.brainRawCaptures.sourceId, sourceIds),
      eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
      inArray(schema.brainCaptureAudiences.audienceId, audienceIds),
    ];
    if (args.captureId) {
      captureClauses.push(eq(schema.brainRawCaptures.id, args.captureId));
    }
    if (args.status) {
      captureClauses.push(eq(schema.brainRawCaptures.status, args.status));
    }
    if (args.kind) {
      captureClauses.push(eq(schema.brainRawCaptures.kind, args.kind));
    }

    const previewSliceLength = args.includePreview
      ? Math.min(args.previewLength * 4, 4000)
      : 0;
    const rows = await db
      .selectDistinct({
        id: schema.brainRawCaptures.id,
        sourceId: schema.brainRawCaptures.sourceId,
        externalId: schema.brainRawCaptures.externalId,
        title: schema.brainRawCaptures.title,
        kind: schema.brainRawCaptures.kind,
        status: schema.brainRawCaptures.status,
        capturedAt: schema.brainRawCaptures.capturedAt,
        metadataJson: schema.brainRawCaptures.metadataJson,
        omissionMarker: sql<boolean>`${schema.brainRawCaptures.content} LIKE ${"%[…]%"}`,
        createdAt: schema.brainRawCaptures.createdAt,
        updatedAt: schema.brainRawCaptures.updatedAt,
        ...(args.includePreview
          ? {
              contentPreviewRaw: sql<string>`substr(${schema.brainRawCaptures.content}, 1, ${previewSliceLength})`,
            }
          : {}),
      })
      .from(schema.brainRawCaptures)
      .innerJoin(
        schema.brainCaptureAudiences,
        eq(schema.brainCaptureAudiences.captureId, schema.brainRawCaptures.id),
      )
      .where(and(...captureClauses))
      .orderBy(desc(schema.brainRawCaptures.capturedAt))
      .limit(args.limit);
    const markerCandidates = rows
      .filter(
        (row) =>
          row.omissionMarker &&
          row.kind === "transcript" &&
          readWithheldPassages(parseCaptureMetadata(row.metadataJson) ?? {}) ===
            undefined,
      )
      .map((row) => row.id);
    const standaloneMarker = new Set(
      (markerCandidates.length
        ? await db
            .select({
              id: schema.brainRawCaptures.id,
              content: schema.brainRawCaptures.content,
            })
            .from(schema.brainRawCaptures)
            .where(inArray(schema.brainRawCaptures.id, markerCandidates))
        : []
      )
        .filter(
          (row) =>
            withOmissionReceipt("{}", row.content, "transcript") !== "{}",
        )
        .map((row) => row.id),
    );
    const queueByCapture = await latestDistillationQueuesForCaptures(
      rows.map((row) => row.id),
    );

    return {
      count: rows.length,
      captures: rows.flatMap((row) => {
        const source = sourceMap.get(row.sourceId);
        if (!source) return [];
        const metadata = parseCaptureMetadata(
          standaloneMarker.has(row.id)
            ? withOmissionReceipt(row.metadataJson, "[…]", row.kind)
            : row.metadataJson,
        );
        const withheldPassages = withheldPassageCount(
          metadata,
          source.provider,
          row.kind,
        );
        return [
          {
            id: row.id,
            sourceId: row.sourceId,
            source: {
              id: source.id,
              title: redactSensitiveText(
                publicSourceTitle(source.title, withheldPassages),
              ),
              provider: source.provider,
              status: source.status,
            },
            externalId: redactOptionalText(
              publicCaptureExternalId(row.externalId, metadata, row.kind),
            ),
            title: redactSensitiveText(
              publicCaptureTitle(row.title, withheldPassages !== 0),
            ),
            kind: row.kind,
            status: row.status,
            capturedAt: row.capturedAt,
            sourceUrl: sourceUrlFromMetadataRecord(metadata ?? {}),
            withheldPassages,
            distillationQueue: redactDistillationQueue(
              queueByCapture.get(row.id) ?? null,
            ),
            preview: args.includePreview
              ? contentPreview(
                  previewRawFromRow(row as Record<string, unknown>),
                  args.previewLength,
                )
              : undefined,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        ];
      }),
    };
  },
});
