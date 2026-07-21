import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, ne, notExists, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  contentHash,
  invalidateDerivedForCapture,
  nowIso,
} from "../server/lib/brain.js";
import { enqueueCaptureInvalidation } from "../server/lib/ingest-queue.js";
import { booleanishSchema, idSchema } from "./_schemas.js";

const REMEDIATION_POLICY_VERSION = "legacy-audience-remediation-v1";

export const remediateLegacyCaptureAudiencesSchema = z.object({
  sourceId: idSchema,
  dryRun: booleanishSchema.default(true),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

function missingAudienceLineage(db: Pick<ReturnType<typeof getDb>, "select">) {
  return notExists(
    db
      .select({ id: schema.brainCaptureAudiences.id })
      .from(schema.brainCaptureAudiences)
      .where(
        eq(schema.brainCaptureAudiences.captureId, schema.brainRawCaptures.id),
      ),
  );
}

export default defineAction({
  description:
    "Dry-run or remediate legacy pending Brain captures that have no audience lineage. Execution scrubs the raw capture and invalidates all derived knowledge.",
  schema: remediateLegacyCaptureAudiencesSchema,
  needsApproval: ({ dryRun }) => !dryRun,
  toolCallable: false,
  run: async (args) => {
    await assertAccess("brain-source", args.sourceId, "editor");
    const db = getDb();
    const candidates = await db
      .select({
        id: schema.brainRawCaptures.id,
        sourceId: schema.brainRawCaptures.sourceId,
        contentHash: schema.brainRawCaptures.contentHash,
        sensitivityPolicyVersion:
          schema.brainRawCaptures.sensitivityPolicyVersion,
        audienceAclHash: schema.brainRawCaptures.audienceAclHash,
      })
      .from(schema.brainRawCaptures)
      .where(
        and(
          eq(schema.brainRawCaptures.sourceId, args.sourceId),
          eq(schema.brainRawCaptures.sensitivityDisposition, "pending"),
          or(
            isNull(schema.brainRawCaptures.sensitivityPolicyVersion),
            ne(
              schema.brainRawCaptures.sensitivityPolicyVersion,
              REMEDIATION_POLICY_VERSION,
            ),
          ),
          missingAudienceLineage(db),
        ),
      )
      .orderBy(asc(schema.brainRawCaptures.id))
      .limit(args.limit);

    const matchedCaptureIds = candidates.map((capture) => capture.id);
    if (args.dryRun || candidates.length === 0) {
      return {
        dryRun: args.dryRun,
        sourceId: args.sourceId,
        matchedCount: candidates.length,
        remediatedCount: 0,
        skippedCount: 0,
        matchedCaptureIds,
        remediatedCaptureIds: [] as string[],
        skippedCaptureIds: [] as string[],
      };
    }

    const emptyContentHash = await contentHash("");
    const remediatedCaptureIds: string[] = [];
    const skippedCaptureIds: string[] = [];

    for (const capture of candidates) {
      const scrubbed = await db
        .update(schema.brainRawCaptures)
        .set({
          title: "Legacy capture removed",
          content: "",
          contentHash: emptyContentHash,
          metadataJson: "{}",
          status: "ignored",
          distilledAt: null,
          sensitivityDisposition: "pending",
          audienceAclHash: null,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(schema.brainRawCaptures.id, capture.id),
            eq(schema.brainRawCaptures.sourceId, args.sourceId),
            eq(schema.brainRawCaptures.sensitivityDisposition, "pending"),
            or(
              isNull(schema.brainRawCaptures.sensitivityPolicyVersion),
              ne(
                schema.brainRawCaptures.sensitivityPolicyVersion,
                REMEDIATION_POLICY_VERSION,
              ),
            ),
            missingAudienceLineage(db),
          ),
        );
      if (scrubbed.rowsAffected === 0) {
        skippedCaptureIds.push(capture.id);
        continue;
      }

      await invalidateDerivedForCapture(capture.id);
      await enqueueCaptureInvalidation({
        captureId: capture.id,
        sourceId: capture.sourceId,
        reason: "sensitivity-changed",
        previous: {
          contentHash: capture.contentHash ?? undefined,
          sensitivityPolicyVersion:
            capture.sensitivityPolicyVersion ?? undefined,
          aclHash: capture.audienceAclHash ?? undefined,
        },
      });

      const completed = await db
        .update(schema.brainRawCaptures)
        .set({
          sensitivityPolicyVersion: REMEDIATION_POLICY_VERSION,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(schema.brainRawCaptures.id, capture.id),
            eq(schema.brainRawCaptures.sourceId, args.sourceId),
            eq(schema.brainRawCaptures.sensitivityDisposition, "pending"),
            missingAudienceLineage(db),
          ),
        );
      if (completed.rowsAffected === 0) {
        skippedCaptureIds.push(capture.id);
        continue;
      }
      remediatedCaptureIds.push(capture.id);
    }

    return {
      dryRun: false,
      sourceId: args.sourceId,
      matchedCount: candidates.length,
      remediatedCount: remediatedCaptureIds.length,
      skippedCount: skippedCaptureIds.length,
      matchedCaptureIds,
      remediatedCaptureIds,
      skippedCaptureIds,
    };
  },
});
