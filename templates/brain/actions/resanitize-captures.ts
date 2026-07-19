import { defineAction } from "@agent-native/core";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ensureCaptureAudience } from "../server/lib/audiences.js";
import {
  contentHash,
  getAccessibleCapture,
  invalidateDerivedForCapture,
  nowIso,
  parseJson,
  readBrainSettings,
  recordBlockedCapture,
  stableJson,
} from "../server/lib/brain.js";
import { sanitizeCaptureForStorage } from "../server/lib/capture-sanitization.js";
import { enqueueCaptureInvalidation } from "../server/lib/ingest-queue.js";
import { redactSensitiveText } from "../server/lib/search.js";
import type { BrainCaptureKind, BrainSourceProvider } from "../shared/types.js";
import { idSchema, stringArrayCliSchema } from "./_schemas.js";

function reviewPreview(value: string) {
  return redactSensitiveText(value).replace(/\s+/g, " ").trim().slice(0, 320);
}

function canEditSource(role: "viewer" | "editor" | "admin" | "owner") {
  return role === "editor" || role === "admin" || role === "owner";
}

async function findDerivedCitationRefs(captureId: string) {
  const db = getDb();
  const needle = `%${captureId}%`;
  const [knowledge, proposals] = await Promise.all([
    db
      .select({ id: schema.brainKnowledge.id })
      .from(schema.brainKnowledge)
      .where(
        and(
          accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
          or(
            eq(schema.brainKnowledge.captureId, captureId),
            like(schema.brainKnowledge.evidenceJson, needle),
          ),
        ),
      )
      .limit(10),
    db
      .select({ id: schema.brainProposals.id })
      .from(schema.brainProposals)
      .where(
        and(
          accessFilter(schema.brainProposals, schema.brainProposalShares),
          or(
            eq(schema.brainProposals.captureId, captureId),
            like(schema.brainProposals.evidenceJson, needle),
          ),
        ),
      )
      .limit(10),
  ]);
  return {
    knowledgeIds: knowledge.map((row) => row.id),
    proposalIds: proposals.map((row) => row.id),
  };
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
      allowCitationDrift: z.coerce
        .boolean()
        .default(false)
        .describe(
          "Allow rewriting captures that already have derived knowledge or proposals citing them. Prefer dryRun first.",
        ),
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
        .select({ id: schema.brainRawCaptures.id })
        .from(schema.brainRawCaptures)
        .where(
          args.includeNonTranscript
            ? and(
                eq(schema.brainRawCaptures.sourceId, source.id),
                eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
              )
            : and(
                eq(schema.brainRawCaptures.sourceId, source.id),
                eq(schema.brainRawCaptures.kind, "transcript"),
                eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
              ),
        )
        .orderBy(desc(schema.brainRawCaptures.capturedAt))
        .limit(args.limit);
      for (const candidate of captures) {
        const access = await getAccessibleCapture(candidate.id);
        if (!access) continue;
        rows.push({ capture: access.capture, source: access.source });
      }
    }

    if (args.captureIds?.length) {
      const captures = await db
        .select({ id: schema.brainRawCaptures.id })
        .from(schema.brainRawCaptures)
        .where(
          and(
            inArray(schema.brainRawCaptures.id, args.captureIds),
            eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
          ),
        )
        .limit(args.captureIds.length);
      for (const candidate of captures) {
        const access = await getAccessibleCapture(candidate.id);
        if (!access || !canEditSource(access.role)) continue;
        if (
          !args.includeNonTranscript &&
          access.capture.kind !== "transcript"
        ) {
          continue;
        }
        rows.push({
          capture: access.capture,
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
      const derivedRefs = await findDerivedCitationRefs(row.capture.id);
      const hasDerivedRefs =
        derivedRefs.knowledgeIds.length > 0 ||
        derivedRefs.proposalIds.length > 0;
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
      if (
        !args.dryRun &&
        sanitized.decision &&
        sanitized.decision.disposition !== "allowed"
      ) {
        await recordBlockedCapture({
          id: row.capture.id,
          existing: row.capture,
          source: row.source,
          values: {
            id: row.capture.id,
            sourceId: row.capture.sourceId,
            externalId: row.capture.externalId,
            title: row.capture.title,
            kind: row.capture.kind as BrainCaptureKind,
            content: row.capture.content,
            metadata: parseJson<Record<string, unknown>>(
              row.capture.metadataJson,
              {},
            ),
            capturedAt: row.capture.capturedAt,
            status: row.capture.status,
          },
          decision: sanitized.decision,
          retentionHours: settings.quarantineRetentionHours ?? 72,
        });
        results.push({
          id: row.capture.id,
          sourceId: row.capture.sourceId,
          externalId: row.capture.externalId,
          title: "Privacy-blocked capture",
          capturedAt: row.capture.capturedAt,
          beforeLength,
          afterLength: 0,
          method: sanitizer?.method ?? "deterministic",
          rawContentRetained: false,
          skipped: false,
          dependentKnowledgeIds: derivedRefs.knowledgeIds,
          dependentProposalIds: derivedRefs.proposalIds,
          preview: "",
        });
        continue;
      }
      if (!args.dryRun) {
        const nextContentHash = await contentHash(sanitized.content);
        let aclHash = row.capture.audienceAclHash;
        if (!aclHash && sanitized.decision?.disposition === "allowed") {
          aclHash = (
            await ensureCaptureAudience({
              captureId: row.capture.id,
              source: row.source,
              memberEmails:
                row.source.visibility === "org"
                  ? undefined
                  : [row.source.ownerEmail],
            })
          ).aclHash;
        }
        await db
          .update(schema.brainRawCaptures)
          .set({
            title: sanitized.title,
            content:
              sanitized.decision?.disposition === "allowed"
                ? sanitized.content
                : "",
            contentHash:
              sanitized.decision?.disposition === "allowed"
                ? nextContentHash
                : await contentHash(""),
            metadataJson: stableJson(sanitized.metadata),
            sensitivityDisposition:
              sanitized.decision?.disposition === "allowed"
                ? "allowed"
                : "pending",
            sensitivityPolicyVersion: sanitized.decision?.policyVersion ?? null,
            audienceAclHash:
              sanitized.decision?.disposition === "allowed" ? aclHash : null,
            status:
              sanitized.decision?.disposition === "allowed"
                ? row.capture.status
                : "ignored",
            updatedAt: nowIso(),
          })
          .where(eq(schema.brainRawCaptures.id, row.capture.id));
        if (
          hasDerivedRefs &&
          (sanitized.decision?.disposition !== "allowed" ||
            row.capture.contentHash !== nextContentHash)
        ) {
          await invalidateDerivedForCapture(row.capture.id);
        }
        await enqueueCaptureInvalidation({
          captureId: row.capture.id,
          sourceId: row.capture.sourceId,
          reason:
            sanitized.decision?.disposition === "allowed"
              ? "content-changed"
              : "sensitivity-changed",
          previous: {
            contentHash: row.capture.contentHash ?? undefined,
            sensitivityPolicyVersion:
              row.capture.sensitivityPolicyVersion ?? undefined,
            aclHash: row.capture.audienceAclHash ?? undefined,
          },
          next:
            sanitized.decision?.disposition === "allowed" && aclHash
              ? {
                  contentHash: nextContentHash,
                  sensitivityPolicyVersion: sanitized.decision.policyVersion,
                  aclHash,
                }
              : undefined,
        });
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
        rawContentRetained: sanitizer?.rawContentRetained ?? false,
        skipped: false,
        dependentKnowledgeIds: derivedRefs.knowledgeIds,
        dependentProposalIds: derivedRefs.proposalIds,
        preview: reviewPreview(sanitized.content),
      });
    }

    return {
      dryRun: args.dryRun,
      requested: deduped.length,
      updated: args.dryRun
        ? 0
        : results.filter((result) => !result.skipped).length,
      results,
    };
  },
});
