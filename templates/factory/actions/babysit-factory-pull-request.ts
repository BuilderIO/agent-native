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
import { buildBabysitAuditDetails } from "../server/triage/babysit-audit-details.js";
import {
  babysitMechanicalVerdict,
  readBabysitEvidence,
  readBabysitStoredState,
} from "../server/triage/babysit-evidence.js";
import {
  babysitSkipSummaryForClosedPullRequest,
  closedPullRequestKind,
  closedPullRequestTerminalMetadataPatch,
  terminalItemStatusForClosedPullRequest,
} from "../server/triage/babysit-pr-terminal.js";
import { computeBabysitRecommendation } from "../server/triage/babysit-recommendation.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import {
  metadataNumber,
  metadataString,
  parseTriageMetadata,
  serializeTriageMetadata,
  triageItemAuthor,
} from "../server/triage/metadata.js";
import {
  babysitAlreadyAskedClause,
  babysitDeferClause,
  babysitFingerprint,
  babysitHeldPingClause,
  babysitOutOfScopeClause,
  babysitStuckClause,
  botReviewBodyKeys,
  BABYSIT_COMMENT_V2,
  countFactoryBabysitComments,
  countHumanReviewBodies,
  countHumanReviewComments,
  CURRENT_BABYSIT_COMMENT_VERSION,
  DEFAULT_BABYSIT_BOT_AUTHORS,
  formatBabysitAuditSummary,
  formatBabysitMergeableAuditSummary,
  hasHumanChangesRequested,
  reconcileBabysitState,
  shouldRecordBabysitAudit,
  shouldVetoDuplicateBabysitComment,
  type BabysitAgentDecision,
  type BabysitPingReason,
} from "../server/triage/pr-babysit.js";

const babysitDecisionSchema = z.enum([
  "ping",
  "defer",
  "already_asked",
  "stuck",
]);
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
    "Act on one pull request after propose-pr-babysit-status. When inScope is true you must pass decision: ping asks Builder to fix feedback using the hardcoded comment, defer parks while Builder is active within the quiet window, already_asked parks until new review work appears, stuck parks for a human because another request cannot unblock it. A ping is refused when Factory already posted on this head, when Builder is active, when the comment list was capped, or when GitHub merely finished computing mergeability; a refused ping parks as waiting and returns a veto instead of posting. Pass inScope false to record a skip for a pull request this factory should not babysit. Never merges or approves.",
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
        "Required when inScope is true. ping, defer, already_asked, or stuck.",
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
    if (inScope && !decision) {
      throw new Error(
        "PR babysitting requires decision (ping, defer, already_asked, or stuck) when inScope is true. Call propose-pr-babysit-status first.",
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
      const closedKind = closedPullRequestKind(read.summary);
      if (!closedKind) {
        throw new Error("Closed pull request disposition is unreadable.");
      }
      await updateBabysitItem(
        itemId,
        orgId,
        closedPullRequestTerminalMetadataPatch(
          closedKind,
          nowIso,
          read.summary,
        ),
        { status: terminalItemStatusForClosedPullRequest(closedKind) },
      );
      const reason = babysitSkipSummaryForClosedPullRequest(
        item.pullRequestNumber,
        closedKind,
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
            merged: read.summary.merged,
            ...(read.summary.mergedAt
              ? { mergedAt: read.summary.mergedAt }
              : {}),
            terminal: closedKind,
          },
        },
        factoryId,
      );
      return { ok: true, action: "skipped", reason };
    }

    const { summary: pullRequest, details } = read;

    const metadata = parseTriageMetadata(item.metadataJson);
    const stored = readBabysitStoredState(metadata);
    const proposal = reconcileBabysitState({
      comments: details.comments,
      checks: details.checks,
      checksCoverage: details.checksCoverage,
      commentsTruncated: details.commentsTruncated,
      reviews: details.reviews,
      reviewsTruncated: details.reviewsTruncated,
      failingJobLog,
      botAuthors: [...DEFAULT_BABYSIT_BOT_AUTHORS],
      issueComments: details.issueComments,
      lastCommentAtMs: stored.lastCommentAtMs,
    });
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
    const nextBotReviewBodyKeys = botReviewBodyKeys(details.comments);
    const commentVersion =
      metadataNumber(metadata, "prBabysitCommentVersion") ??
      CURRENT_BABYSIT_COMMENT_VERSION;
    const factoryPingCount = countFactoryBabysitComments(
      details.issueComments,
      stored.factoryAuthor,
      commentVersion,
    );
    const recommendationResult = computeBabysitRecommendation({
      proposal,
      mechanical,
      checks: details.checks,
      comments: details.comments,
      issueComments: details.issueComments,
      lastCommentAtMs: stored.lastCommentAtMs,
      lastPingHeadSha: stored.lastPingHeadSha,
      headSha: pullRequest.headSha,
      nowMs: now.getTime(),
    });
    const buildAuditDetails = (overrides?: {
      veto?: string;
      appliedAction?: string;
      pingReason?: string;
      commentUrl?: string;
    }) =>
      buildBabysitAuditDetails({
        headSha: pullRequest.headSha,
        proposal,
        mechanical,
        recommendation: recommendationResult.recommendation,
        because: recommendationResult.because,
        decision: decision as BabysitAgentDecision | undefined,
        builderActive: recommendationResult.builderActive,
        builderActiveUntil: recommendationResult.builderActiveUntil,
        factoryPingCount,
        lastFactoryPingAt: stored.lastCommentAt,
        comments: details.comments,
        ...overrides,
      });
    const parkedPatch = {
      prBabysitHumanReviewCommentCount: countHumanReviewComments(
        details.comments,
      ),
      prBabysitHumanReviewBodyCount: countHumanReviewBodies(details.reviews),
      prBabysitBotReviewBodyKeys: nextBotReviewBodyKeys,
      prBabysitCommentsTruncated: details.commentsTruncated === true,
      prBabysitReviewsTruncated: details.reviewsTruncated === true,
      prBabysitChangesRequested: hasHumanChangesRequested(details.reviews),
      prBabysitMergeConflict: mechanical.mergeability.mergeConflict,
      prBabysitMergeabilityComputed:
        mechanical.mergeability.mergeabilityComputed,
      ...(consumedPendingReopen ? { prBabysitPendingReopen: false } : {}),
    };

    const park = async (
      nextState: string,
      clause: string,
      options?: {
        status?: string;
        veto?: BabysitPingReason | string;
        appliedAction?: string;
        metadata?: Record<string, unknown>;
      },
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
            details: buildAuditDetails({
              veto: options?.veto ?? undefined,
              appliedAction: options?.appliedAction ?? undefined,
            }),
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
          ...(options?.metadata ?? {}),
        },
        {
          status: options?.status,
          touchUpdatedAt: previousState !== nextState,
        },
      );
    };

    const vetoHeldPing = async (reason: BabysitPingReason) => {
      await park("waiting", babysitHeldPingClause(reason), { veto: reason });
      return { ok: true as const, action: "waiting" as const, veto: reason };
    };

    const shouldVetoDuplicate = (count: number) =>
      shouldVetoDuplicateBabysitComment({
        existingFactoryBabysitCommentCount: count,
        newHumanWork: mechanical.newHumanWork,
        newBotWork: mechanical.newBotWork,
        newDefiniteMergeConflict: mechanical.newDefiniteMergeConflict,
        headShaChangedSinceLastPing: mechanical.headShaChangedSinceLastPing,
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
        if (
          shouldVetoDuplicate(
            countFactoryBabysitComments(
              contendedScan.comments,
              stored.factoryAuthor,
              commentVersion,
            ),
          )
        ) {
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
      if (
        !mechanical.needsWork &&
        proposal.isClean &&
        proposal.unansweredBotComments.length === 0
      ) {
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
              summary: formatBabysitMergeableAuditSummary(
                item.pullRequestNumber,
                nowIso,
              ),
              details: buildAuditDetails(),
            },
            factoryId,
          );
        }
        await updateBabysitItem(
          itemId,
          orgId,
          {
            prBabysitState: "clean",
            prBabysitMergeableAt: nowIso,
            prBabysitLastCheckedAt: nowIso,
            prBabysitFingerprint: fingerprint,
            ...parkedPatch,
          },
          { touchUpdatedAt: previousState !== "clean" },
        );
        return { ok: true, action: "clean" };
      }

      if (mechanical.builderActive) {
        const builderActiveUntil =
          recommendationResult.builderActiveUntil ??
          mechanical.builderActiveUntil;
        if (!builderActiveUntil) {
          throw new Error(
            "Builder-active defer is missing prBabysitBuilderActiveUntil.",
          );
        }
        await park("defer", babysitDeferClause(), {
          metadata: { prBabysitBuilderActiveUntil: builderActiveUntil },
          ...(decision === "stuck"
            ? {
                veto: "builder-active-overrides-stuck",
                appliedAction: "defer",
              }
            : {}),
        });
        return { ok: true, action: "defer" };
      }
      if (decision === "defer") {
        await park(
          "waiting",
          "waiting; Builder is not active, so defer does not apply.",
        );
        return { ok: true, action: "waiting" };
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
        return {
          ok: true,
          action: "waiting",
          veto: mechanical.ping.reason,
        };
      }

      const preClaimScan = await scanIssueComments();
      if (preClaimScan.truncated) {
        return vetoHeldPing("comment-scan-truncated");
      }
      if (
        shouldVetoDuplicate(
          countFactoryBabysitComments(
            preClaimScan.comments,
            stored.factoryAuthor,
            commentVersion,
          ),
        )
      ) {
        return vetoHeldPing("duplicate-comment");
      }

      const finalScan = await scanIssueComments();
      if (finalScan.truncated) {
        return vetoHeldPing("comment-scan-truncated");
      }
      if (
        shouldVetoDuplicate(
          countFactoryBabysitComments(
            finalScan.comments,
            stored.factoryAuthor,
            commentVersion,
          ),
        )
      ) {
        return vetoHeldPing("duplicate-comment");
      }

      const comment = await github.createIssueComment(
        repository,
        pullRequestNumber,
        BABYSIT_COMMENT_V2,
      );
      await updateBabysitItem(itemId, orgId, {
        prBabysitState: "waiting",
        prBabysitFingerprint: fingerprint,
        prBabysitLastCheckedAt: nowIso,
        prBabysitLastCommentAt: nowIso,
        prBabysitLastCommentUrl: comment.htmlUrl,
        prBabysitLastPingHeadSha: pullRequest.headSha,
        prBabysitFactoryAuthor: comment.author,
        prBabysitCommentVersion: CURRENT_BABYSIT_COMMENT_VERSION,
        ...parkedPatch,
      });
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
          details: buildAuditDetails({
            pingReason: mechanical.ping.reason,
            commentUrl: comment.htmlUrl,
          }),
        },
        factoryId,
      );
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
