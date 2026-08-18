import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { pullRequestSnapshotToEnvelope } from "../server/triage/github-ingestion.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import type {
  PullRequestCheckObservation,
  PullRequestReviewObservation,
} from "../server/triage/pr-monitor.js";

const reviewSchema: z.ZodType<PullRequestReviewObservation> = z.object({
  author: z.string().min(1),
  state: z.enum(["approved", "changes_requested", "commented", "pending"]),
  observedAt: z.string().datetime(),
});

const checkSchema: z.ZodType<PullRequestCheckObservation> = z.object({
  name: z.string().min(1),
  state: z.enum(["queued", "in_progress", "passed", "failed", "cancelled"]),
  observedAt: z.string().datetime(),
});

export default defineAction({
  description:
    "Ingest one read-only GitHub pull-request observation from the existing ai-services boundary into Factory. This action records evidence only and never writes to GitHub.",
  schema: z.object({
    repo: z.string().trim().min(1).max(256),
    pullRequestNumber: z.number().int().positive(),
    headSha: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(500),
    sourceUrl: z.string().url().optional(),
    summary: z.string().trim().max(4_000).optional(),
    changedFiles: z.array(z.string().max(500)).max(500).optional(),
    diffLines: z.number().int().nonnegative().optional(),
    coverage: z.enum(["complete", "partial", "unknown", "unavailable"]),
    reviews: z.array(reviewSchema).max(500).default([]),
    checks: z.array(checkSchema).max(500).default([]),
    observedAt: z.string().datetime(),
  }),
  http: false,
  agentTool: false,
  run: async (input, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const envelope = pullRequestSnapshotToEnvelope(input);
    const id = itemDedupeKey(envelope, orgId);
    const now = new Date().toISOString();
    const db = getDb();

    await db
      .insert(triageItems)
      .values({
        id,
        source: envelope.source,
        externalId: envelope.externalId,
        sourceUrl: envelope.sourceUrl ?? null,
        title: envelope.title,
        summary: envelope.summary ?? null,
        status: "evidence_ready",
        risk: "unknown",
        repository: envelope.repository ?? null,
        pullRequestNumber: envelope.pullRequestNumber ?? null,
        headSha: envelope.headSha ?? null,
        coverage: envelope.coverage,
        dedupeKey: id,
        metadataJson: JSON.stringify(envelope.metadata ?? {}),
        lastSeenAt: envelope.receivedAt,
        createdAt: now,
        updatedAt: now,
        ownerEmail: userEmail,
        orgId,
      })
      .onConflictDoUpdate({
        target: triageItems.id,
        set: {
          sourceUrl: envelope.sourceUrl ?? null,
          title: envelope.title,
          summary: envelope.summary ?? null,
          coverage: envelope.coverage,
          metadataJson: JSON.stringify(envelope.metadata ?? {}),
          lastSeenAt: envelope.receivedAt,
          updatedAt: now,
        },
      });

    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "ingest-github-observation",
        kind: "observed",
        itemId: id,
        source: envelope.source,
        sourceUrl: envelope.sourceUrl,
        summary: envelope.title,
        details: {
          repository: envelope.repository,
          pullRequestNumber: envelope.pullRequestNumber,
          coverage: envelope.coverage,
          reviewCount: input.reviews.length,
          checkCount: input.checks.length,
        },
      },
    );

    return {
      ok: true,
      id,
      source: envelope.source,
      coverage: envelope.coverage,
    };
  },
});
