import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import { resolveFactoryRepository } from "../server/lib/factory-repository-scope.js";
import {
  factoryIdSchema,
  factoryStillPresent,
  requireExistingFactory,
} from "../server/lib/factory-scope.js";
import {
  gitHubRepositoriesEqual,
  parseGitHubRepositoryRef,
} from "../server/lib/github-repository.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import {
  babysitMechanicalVerdict,
  readBabysitEvidence,
  readBabysitStoredState,
} from "../server/triage/babysit-evidence.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import {
  metadataString,
  parseTriageMetadata,
  serializeTriageMetadata,
  triageItemAuthor,
} from "../server/triage/metadata.js";
import {
  babysitAlreadyAskedClause,
  babysitFingerprint,
  babysitHeldPingClause,
  babysitOutOfScopeClause,
  babysitStuckClause,
  countBabysitComments,
  countHumanReviewBodies,
  countHumanReviewComments,
  DEFAULT_BABYSIT_BOT_AUTHORS,
  DEFAULT_BABYSIT_PR_COMMENT,
  formatBabysitAuditSummary,
  hasHumanChangesRequested,
  reconcileBabysitState,
  shouldRecordBabysitAudit,
  shouldVetoDuplicateBabysitComment,
  type BabysitPingReason,
} from "../server/triage/pr-babysit.js";

const babysitDecisionSchema = z.enum(["ping", "already_asked", "stuck"]);
const BABYSIT_POST_CLAIM_TTL_MS = 120_000;

async function tryAcquireBabysitPostClaim(
  itemId: string,
  orgId: string,
  factoryId: string,
): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx
      .select({ id: triageItems.id })
      .from(triageItems)
      .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
      .for("update");
    const row = (
      await tx
        .select({ metadataJson: triageItems.metadataJson })
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!row) return false;
    const metadata = parseTriageMetadata(row.metadataJson);
    const claimedAt = metadataString(metadata, "prBabysitPostClaimedAt");
    const claimedMs = claimedAt ? Date.parse(claimedAt) : NaN;
    if (
      Number.isFinite(claimedMs) &&
      Date.now() - claimedMs < BABYSIT_POST_CLAIM_TTL_MS
    ) {
      return false;
    }
    metadata.prBabysitPostClaimedAt = new Date().toISOString();
    await tx
      .update(triageItems)
      .set({ metadataJson: serializeTriageMetadata(metadata) })
      .where(
        and(
          eq(triageItems.id, itemId),
          eq(triageItems.orgId, orgId),
          factoryStillPresent(tx as unknown as typeof db, orgId, factoryId),
        ),
      );
    await requireExistingFactory(tx as unknown as typeof db, orgId, factoryId);
    return true;
  });
}

async function releaseBabysitPostClaim(
  itemId: string,
  orgId: string,
  factoryId: string,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .select({ id: triageItems.id })
      .from(triageItems)
      .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
      .for("update");
    const row = (
      await tx
        .select({ metadataJson: triageItems.metadataJson })
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!row) return;
    const metadata = parseTriageMetadata(row.metadataJson);
    delete metadata.prBabysitPostClaimedAt;
    await tx
      .update(triageItems)
      .set({ metadataJson: serializeTriageMetadata(metadata) })
      .where(
        and(
          eq(triageItems.id, itemId),
          eq(triageItems.orgId, orgId),
          factoryStillPresent(tx as unknown as typeof db, orgId, factoryId),
        ),
      );
    await requireExistingFactory(tx as unknown as typeof db, orgId, factoryId);
  });
}

async function updateBabysitItem(
  itemId: string,
  orgId: string,
  patch: Record<string, unknown>,
  options?: { status?: string; touchUpdatedAt?: boolean },
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .select({ id: triageItems.id })
      .from(triageItems)
      .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
      .for("update");
    const item = (
      await tx
        .select({
          metadataJson: triageItems.metadataJson,
          factoryId: triageItems.factoryId,
        })
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) {
      throw new Error("Factory item disappeared during PR babysitting.");
    }
    const factoryId = item.factoryId ?? DEFAULT_FACTORY_ID;
    const metadata = parseTriageMetadata(item.metadataJson);
    Object.assign(metadata, patch);
    const touchUpdatedAt = options?.touchUpdatedAt !== false;
    await tx
      .update(triageItems)
      .set({
        metadataJson: serializeTriageMetadata(metadata),
        ...(touchUpdatedAt ? { updatedAt: new Date().toISOString() } : {}),
        ...(options?.status ? { status: options.status } : {}),
      })
      .where(
        and(
          eq(triageItems.id, itemId),
          eq(triageItems.orgId, orgId),
          factoryStillPresent(tx as unknown as typeof db, orgId, factoryId),
        ),
      );
    await requireExistingFactory(tx as unknown as typeof db, orgId, factoryId);
  });
}

export default defineAction({
  description:
    "Act on one pull request after propose-pr-babysit-status. When inScope is true you must pass decision: ping asks Builder to fix feedback using the hardcoded comment, already_asked parks the item until new human review appears, stuck parks it for a human because another request cannot unblock it. A ping is refused when Factory already asked, when the comment list was capped, or when GitHub merely finished computing mergeability; a refused ping parks as waiting and returns a veto instead of posting. Every path leaves needsReview until new human review work appears. Pass inScope false to record a skip for a pull request this factory should not babysit. Never merges or approves.",
  schema: z.object({
    itemId: z.string().min(1),
    factoryId: factoryIdSchema.optional(),
    inScope: z
      .boolean()
      .describe(
        "True when this factory's prompt says to babysit this pull request. False records a skip and takes the item out of needsReview.",
      ),
    decision: babysitDecisionSchema
      .optional()
      .describe(
        "Required when inScope is true. ping, already_asked, or stuck.",
      ),
    failingJobLog: z.string().max(50_000).optional(),
  }),
  http: false,
  run: async (
    { itemId, factoryId: factoryIdInput, inScope, decision, failingJobLog },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );

    const db = getDb();
    const item = (
      await db
        .select()
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) throw new Error("Factory item not found for PR babysitting.");
    const factoryId = factoryIdInput ?? item.factoryId ?? DEFAULT_FACTORY_ID;
    if ((item.factoryId ?? DEFAULT_FACTORY_ID) !== factoryId) {
      throw new Error("Factory item does not belong to this factory.");
    }
    // Optional in the schema so an out-of-scope skip does not need a
    // meaningless value, but a missing decision on in-scope work is an error,
    // not a default. Defaulting it would let the agent silently ping.
    if (inScope && !decision) {
      throw new Error(
        "PR babysitting requires decision (ping, already_asked, or stuck) when inScope is true. Call propose-pr-babysit-status first.",
      );
    }
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "prBabysit",
      factoryId,
    );
    if (
      item.source !== "github" ||
      !item.repository ||
      !item.pullRequestNumber ||
      !inScope
    ) {
      const author = triageItemAuthor(item.metadataJson);
      const reason = formatBabysitAuditSummary(
        item.pullRequestNumber,
        inScope
          ? "skipped; item is not a pull request."
          : babysitOutOfScopeClause(author),
      );
      await updateBabysitItem(
        itemId,
        orgId,
        {
          prBabysitState: "out-of-scope",
          prBabysitLastCheckedAt: new Date().toISOString(),
        },
        { status: "needs_manual" },
      );
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "babysit-factory-pull-request",
          kind: "decision",
          status: "skipped",
          itemId,
          source: item.source,
          sourceUrl: item.sourceUrl,
          summary: reason,
          details: { inScope, author },
        },
        factoryId,
      );
      return { ok: true, action: "skipped", reason };
    }

    const configuredRepository = await resolveFactoryRepository(
      db,
      context,
      { userEmail, orgId },
      factoryId,
    );
    if (
      !configuredRepository ||
      !item.repository ||
      !gitHubRepositoriesEqual(configuredRepository, item.repository)
    ) {
      throw new Error(
        "PR babysitting is restricted to the configured Factory repository.",
      );
    }

    const repository = parseGitHubRepositoryRef(item.repository);
    const pullRequestNumber = item.pullRequestNumber;
    if (typeof pullRequestNumber !== "number") {
      throw new Error("Factory item is not a GitHub pull request.");
    }
    const github = createGitHubClient({ ownerEmail: userEmail, orgId });
    const read = await readBabysitEvidence(
      github,
      repository,
      pullRequestNumber,
    );
    const now = new Date();
    const nowIso = now.toISOString();
    if (!read.open) {
      await updateBabysitItem(
        itemId,
        orgId,
        {
          prBabysitState: "closed-or-draft",
          prBabysitLastCheckedAt: nowIso,
        },
        { status: "needs_manual" },
      );
      const reason = formatBabysitAuditSummary(
        item.pullRequestNumber,
        "skipped; pull request is closed or a draft.",
      );
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "babysit-factory-pull-request",
          kind: "decision",
          status: "skipped",
          itemId,
          source: "github",
          sourceUrl: item.sourceUrl,
          summary: reason,
          details: {
            author: read.summary.userLogin,
            state: read.summary.state,
            draft: read.summary.draft,
          },
        },
        factoryId,
      );
      return { ok: true, action: "skipped", reason };
    }

    const { summary: pullRequest, details } = read;

    const proposal = reconcileBabysitState({
      comments: details.comments,
      checks: details.checks,
      checksCoverage: details.checksCoverage,
      commentsTruncated: details.commentsTruncated,
      reviews: details.reviews,
      reviewsTruncated: details.reviewsTruncated,
      failingJobLog,
      botAuthors: [...DEFAULT_BABYSIT_BOT_AUTHORS],
    });
    const metadata = parseTriageMetadata(item.metadataJson);
    const stored = readBabysitStoredState(metadata);
    const previousState = stored.babysitState;
    const mechanical = babysitMechanicalVerdict({
      stored,
      summary: pullRequest,
      details,
      proposal,
      nextHumanReviewCommentCount: countHumanReviewComments(details.comments),
      nextHumanReviewBodyCount: countHumanReviewBodies(details.reviews),
      nextChangesRequested: hasHumanChangesRequested(details.reviews),
      nowMs: now.getTime(),
    });
    const fingerprint = babysitFingerprint({
      headSha: pullRequest.headSha,
      mergeable: pullRequest.mergeable,
      mergeableState: pullRequest.mergeableState,
      storedMergeConflict: stored.mergeConflict,
      snapshot: proposal,
      reviewStates: details.reviews.map((review) => review.state),
    });
    const consumedPendingReopen = stored.pendingReopen;
    const parkedPatch = {
      prBabysitHumanReviewCommentCount: countHumanReviewComments(
        details.comments,
      ),
      prBabysitHumanReviewBodyCount: countHumanReviewBodies(details.reviews),
      prBabysitCommentsTruncated: details.commentsTruncated === true,
      prBabysitReviewsTruncated: details.reviewsTruncated === true,
      prBabysitChangesRequested: hasHumanChangesRequested(details.reviews),
      prBabysitMergeConflict: mechanical.mergeability.mergeConflict,
      prBabysitMergeabilityComputed:
        mechanical.mergeability.mergeabilityComputed,
      ...(consumedPendingReopen ? { prBabysitPendingReopen: false } : {}),
    };
    const evidenceDetails = {
      author: pullRequest.userLogin,
      headSha: pullRequest.headSha,
      checks: details.checks.length,
      comments: details.comments.length,
      mergeable: pullRequest.mergeable,
      mergeableState: pullRequest.mergeableState,
      mergeabilityComputed: mechanical.mergeability.mergeabilityComputed,
      babysitCommentCount: details.babysitCommentCount,
      reviewFeedbackClean: proposal.isClean,
      decision,
    };

    const park = async (
      nextState: string,
      clause: string,
      options?: { status?: string },
    ): Promise<void> => {
      if (
        shouldRecordBabysitAudit({ previousState, nextState, posted: false })
      ) {
        await recordFactoryAudit(
          context,
          { userEmail, orgId },
          {
            action: "babysit-factory-pull-request",
            kind: "decision",
            status: "success",
            itemId,
            source: "github",
            sourceUrl: item.sourceUrl,
            summary: formatBabysitAuditSummary(item.pullRequestNumber, clause),
            details: evidenceDetails,
          },
          factoryId,
        );
      }
      await updateBabysitItem(
        itemId,
        orgId,
        {
          prBabysitState: nextState,
          prBabysitFingerprint: fingerprint,
          prBabysitLastCheckedAt: nowIso,
          ...parkedPatch,
        },
        {
          ...options,
          touchUpdatedAt: previousState !== nextState,
        },
      );
    };

    const vetoHeldPing = async (reason: BabysitPingReason) => {
      await park("waiting", babysitHeldPingClause(reason));
      return { ok: true as const, action: "waiting" as const, veto: reason };
    };

    const shouldVetoDuplicate = (count: number) =>
      shouldVetoDuplicateBabysitComment({
        existingBabysitCommentCount: count,
        newHumanWork: mechanical.newHumanWork,
        newDefiniteMergeConflict: mechanical.newDefiniteMergeConflict,
      });

    const scanIssueComments = async () =>
      github.listIssueComments(repository, pullRequestNumber);

    const acquired = await tryAcquireBabysitPostClaim(itemId, orgId, factoryId);
    if (!acquired) {
      if (decision === "ping") {
        const contendedScan = await scanIssueComments();
        if (contendedScan.truncated) {
          return {
            ok: true,
            action: "waiting",
            veto: "comment-scan-truncated" as const,
          };
        }
        if (shouldVetoDuplicate(countBabysitComments(contendedScan.comments))) {
          return {
            ok: true,
            action: "waiting",
            veto: "duplicate-comment" as const,
          };
        }
      }
      return { ok: true, action: "waiting", veto: "already-asked" as const };
    }

    try {
      if (!mechanical.needsWork) {
        if (
          shouldRecordBabysitAudit({
            previousState,
            nextState: "clean",
            posted: false,
          })
        ) {
          await recordFactoryAudit(
            context,
            { userEmail, orgId },
            {
              action: "babysit-factory-pull-request",
              kind: "decision",
              status: "skipped",
              itemId,
              source: "github",
              sourceUrl: item.sourceUrl,
              summary: formatBabysitAuditSummary(
                item.pullRequestNumber,
                "is clean; no Builder feedback request.",
              ),
              details: evidenceDetails,
            },
            factoryId,
          );
        }
        await updateBabysitItem(
          itemId,
          orgId,
          {
            prBabysitState: "clean",
            prBabysitLastCheckedAt: nowIso,
            prBabysitFingerprint: fingerprint,
            ...parkedPatch,
          },
          { touchUpdatedAt: previousState !== "clean" },
        );
        return { ok: true, action: "clean" };
      }

      if (decision === "stuck") {
        await park("stuck", babysitStuckClause(), { status: "needs_manual" });
        return { ok: true, action: "stuck" };
      }
      if (decision === "already_asked") {
        await park("waiting", babysitAlreadyAskedClause());
        return { ok: true, action: "waiting" };
      }
      if (!mechanical.ping.allowed) {
        await park("waiting", babysitHeldPingClause(mechanical.ping.reason));
        return { ok: true, action: "waiting", veto: mechanical.ping.reason };
      }

      const preClaimScan = await scanIssueComments();
      if (preClaimScan.truncated) {
        return vetoHeldPing("comment-scan-truncated");
      }
      if (shouldVetoDuplicate(countBabysitComments(preClaimScan.comments))) {
        return vetoHeldPing("duplicate-comment");
      }

      const finalScan = await scanIssueComments();
      if (finalScan.truncated) {
        return vetoHeldPing("comment-scan-truncated");
      }
      if (shouldVetoDuplicate(countBabysitComments(finalScan.comments))) {
        return vetoHeldPing("duplicate-comment");
      }

      const comment = await github.createIssueComment(
        repository,
        pullRequestNumber,
        DEFAULT_BABYSIT_PR_COMMENT,
      );
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "babysit-factory-pull-request",
          kind: "external_action",
          itemId,
          source: "github",
          sourceUrl: comment.htmlUrl,
          summary: formatBabysitAuditSummary(
            item.pullRequestNumber,
            "posted the feedback-fix request.",
          ),
          details: {
            author: pullRequest.userLogin,
            commentUrl: comment.htmlUrl,
            pingReason: mechanical.ping.reason,
          },
        },
        factoryId,
      );
      // Posting parks straight to `waiting`: the ask is out, so the item leaves
      // needsReview until poll finds new human review work. An `active` state here
      // is what let mergeability flicker re-list and re-ping the same PR.
      await updateBabysitItem(itemId, orgId, {
        prBabysitState: "waiting",
        prBabysitFingerprint: fingerprint,
        prBabysitLastCheckedAt: nowIso,
        prBabysitLastCommentAt: nowIso,
        prBabysitLastCommentUrl: comment.htmlUrl,
        ...parkedPatch,
      });
      return {
        ok: true,
        action: "commented",
        commentUrl: comment.htmlUrl,
        pingReason: mechanical.ping.reason,
      };
    } finally {
      await releaseBabysitPostClaim(itemId, orgId, factoryId);
    }
  },
});
