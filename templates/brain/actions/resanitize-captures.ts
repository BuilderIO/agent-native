import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  contentHash,
  getAccessibleCapture,
  nowIso,
  parseJson,
  readBrainSettings,
  stableJson,
} from "../server/lib/brain.js";
import { sanitizeCaptureForStorage } from "../server/lib/capture-sanitization.js";
import { redactSensitiveText } from "../server/lib/search.js";
import { idSchema, stringArrayCliSchema } from "./_schemas.js";
import type { BrainCaptureKind, BrainSourceProvider } from "../shared/types.js";

function reviewPreview(value: string) {
  return redactSensitiveText(value).replace(/\s+/g, " ").trim().slice(0, 320);
}

export default defineAction({
  description:
    "Re-run Brain's pre-storage sanitizer over existing transcript captures. Use after enabling or tightening sanitization.",
  schema: z
    .object({
      sourceId: idSchema.optional(),
      captureIds: stringArrayCliSchema({ min: 1, max: 50 }).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(25),
      dryRun: z.coerce.boolean().default(false),
      includeNonTranscript: z.coerce.boolean().default(false),
    })
    .refine((args) => args.sourceId || args.captureIds?.length, {
      message: "Provide sourceId or captureIds",
    }),
  run: async (args) => {
    const db = getDb();
    const settings = await readBrainSettings();
    const rows: Array<{
      capture: typeof schema.brainRawCaptures.$inferSelect;
      source: typeof schema.brainSources.$inferSelect;
    }> = [];

    if (args.sourceId) {
      const sourceAccess = await assertAccess(
        "brain-source",
        args.sourceId,
        "editor",
      );
      const source =
        sourceAccess.resource as typeof schema.brainSources.$inferSelect;
      const captures = await db
        .select()
        .from(schema.brainRawCaptures)
        .where(
          args.includeNonTranscript
            ? eq(schema.brainRawCaptures.sourceId, source.id)
            : and(
                eq(schema.brainRawCaptures.sourceId, source.id),
                eq(schema.brainRawCaptures.kind, "transcript"),
              ),
        )
        .orderBy(desc(schema.brainRawCaptures.capturedAt))
        .limit(args.limit);
      for (const capture of captures) rows.push({ capture, source });
    }

    if (args.captureIds?.length) {
      const captures = await db
        .select()
        .from(schema.brainRawCaptures)
        .where(inArray(schema.brainRawCaptures.id, args.captureIds))
        .limit(args.captureIds.length);
      for (const capture of captures) {
        if (!args.includeNonTranscript && capture.kind !== "transcript") {
          continue;
        }
        const access = await getAccessibleCapture(capture.id);
        if (!access) continue;
        rows.push({
          capture,
          source: access.source,
        });
      }
    }

    const deduped = Array.from(
      new Map(rows.map((row) => [row.capture.id, row])).values(),
    );
    const results = [];
    for (const row of deduped) {
      const beforeLength = row.capture.content.length;
      const sanitized = await sanitizeCaptureForStorage({
        kind: row.capture.kind as BrainCaptureKind,
        title: row.capture.title,
        content: row.capture.content,
        metadata: parseJson<Record<string, unknown>>(
          row.capture.metadataJson,
          {},
        ),
        capturedAt: row.capture.capturedAt,
        source: {
          id: row.source.id,
          title: row.source.title,
          provider: row.source.provider as BrainSourceProvider,
          ownerEmail: row.source.ownerEmail,
        },
        sourceConfig: parseJson<Record<string, unknown>>(
          row.source.configJson,
          {},
        ),
        settings,
      });
      const sanitizer = sanitized.metadata.captureSanitization as
        | Record<string, unknown>
        | undefined;
      if (!args.dryRun) {
        await db
          .update(schema.brainRawCaptures)
          .set({
            title: sanitized.title,
            content: sanitized.content,
            contentHash: await contentHash(sanitized.content),
            metadataJson: stableJson(sanitized.metadata),
            updatedAt: nowIso(),
          })
          .where(eq(schema.brainRawCaptures.id, row.capture.id));
      }
      results.push({
        id: row.capture.id,
        sourceId: row.capture.sourceId,
        externalId: row.capture.externalId,
        title: sanitized.title,
        capturedAt: row.capture.capturedAt,
        beforeLength,
        afterLength: sanitized.content.length,
        method: sanitizer?.method ?? "not-sanitized",
        rawContentRetained: sanitizer?.rawContentRetained ?? true,
        preview: reviewPreview(sanitized.content),
      });
    }

    return {
      dryRun: args.dryRun,
      requested: deduped.length,
      updated: args.dryRun ? 0 : results.length,
      results,
    };
  },
});
