import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  factoryIdSchema,
  factoryStillPresent,
  readTriageConfigRow,
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
import { createGitHubClient } from "../server/triage/github-client.js";
import {
  metadataString,
  parseTriageMetadata,
  serializeTriageMetadata,
  triageItemAuthor,
} from "../server/triage/metadata.js";
import {
  babysitFingerprint,
  babysitOutOfScopeClause,
  DEFAULT_BABYSIT_BOT_AUTHORS,
  formatBabysitAuditSummary,
  reconcileBabysitState,
  shouldRequestBabysitWork,
} from "../server/triage/pr-babysit.js";
import { detectOwnerOwnedArea } from "../server/triage/pr-policy.js";

const QUIET_PERIOD_MS = 20 * 60_000;
const MIN_COMMENT_INTERVAL_MS = 90_000;
const BUILDER_BOT_REQUEST =
  "@builderio-bot look at latest PR feedback and fix anything you agree with. Be skeptical. Reply to every comment (directly on the comment thread of each comment) if you fixed it or not and why. then check back every 2 minutes on a loop and see if any new feedback posted, until at least 20 minutes go by without any new feedback posted we want to address, including making sure CI passes too and no merge conflicts (make sure code is mergeable)";

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function updateBabysitItem(
  itemId: string,
  orgId: string,
  patch: Record<string, unknown>,
  status?: string,
): Promise<void> {
  const db = getDb();
  const item = (
    await db
      .select({
        metadataJson: triageItems.metadataJson,
        factoryId: triageItems.factoryId,
      })
      .from(triageItems)
      .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
      .limit(1)
  )[0];
  if (!item) throw new Error("Factory item disappeared during PR babysitting.");
  const factoryId = item.factoryId ?? DEFAULT_FACTORY_ID;
  const metadata = parseTriageMetadata(item.metadataJson);
  Object.assign(metadata, patch);
  await db.transaction(async (tx) => {
    await tx
      .update(triageItems)
      .set({
        metadataJson: serializeTriageMetadata(metadata),
        updatedAt: new Date().toISOString(),
        ...(status ? { status } : {}),
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
    "Watch one pull request using GitHub review and CI evidence, post the bounded feedback-fix request when that evidence needs work, and stop after 20 quiet minutes. Pass inScope true only when this factory's prompt says the pull request should be babysat. inScope false records a skip and removes the item from the review window. Never merges or approves. Use propose-pr-babysit-status for a read-only proposal.",
  schema: z.object({
    itemId: z.string().min(1),
    factoryId: factoryIdSchema.optional(),
    inScope: z
      .boolean()
      .describe(
        "True when this factory's prompt says to babysit this pull request. False records a skip and takes the item out of needsReview.",
      ),
  }),
  http: false,
  run: async ({ itemId, factoryId: factoryIdInput, inScope }, context) => {
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
        "needs_manual",
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

    const configuredRepository = (
      await readTriageConfigRow(db, orgId, factoryId)
    )?.repository;
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
    const github = createGitHubClient({ ownerEmail: userEmail, orgId });
    const pullRequest = await github.getPullRequestSummary(
      repository,
      item.pullRequestNumber,
    );
    if (pullRequest.state !== "open" || pullRequest.draft) {
      await updateBabysitItem(
        itemId,
        orgId,
        {
          prBabysitState: "closed-or-draft",
          prBabysitLastCheckedAt: new Date().toISOString(),
        },
        "needs_manual",
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
            author: pullRequest.userLogin,
            state: pullRequest.state,
            draft: pullRequest.draft,
          },
        },
        factoryId,
      );
      return { ok: true, action: "skipped", reason };
    }

    const ownerOwnedArea = detectOwnerOwnedArea([
      item.repository,
      pullRequest.title,
      pullRequest.body,
    ]);
    if (ownerOwnedArea) {
      await updateBabysitItem(
        itemId,
        orgId,
        {
          prBabysitState: "owner-managed",
          prBabysitOwnerArea: ownerOwnedArea,
          prBabysitLastCheckedAt: new Date().toISOString(),
        },
        "needs_manual",
      );
      const reason = formatBabysitAuditSummary(
        item.pullRequestNumber,
        `skipped; ${ownerOwnedArea} is owner-managed.`,
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
          details: { author: pullRequest.userLogin, ownerOwnedArea },
        },
        factoryId,
      );
      return {
        ok: true,
        action: "skipped",
        reason,
      };
    }

    const snapshot = await github.getPullRequestEvidence(
      repository,
      item.pullRequestNumber,
      pullRequest.headSha,
    );

    const proposal = reconcileBabysitState({
      comments: snapshot.comments,
      checks: snapshot.checks,
      checksCoverage: snapshot.checksCoverage,
      commentsTruncated: snapshot.commentsTruncated,
      botAuthors: [...DEFAULT_BABYSIT_BOT_AUTHORS],
    });
    const unresolvedReviewState = snapshot.reviews.some(
      (review) =>
        review.state === "changes_requested" || review.state === "pending",
    );
    const signal = {
      ...proposal,
      isClean: proposal.isClean && !unresolvedReviewState,
    };
    const needsBabysit = shouldRequestBabysitWork({
      mergeable: pullRequest.mergeable,
      mergeableState: pullRequest.mergeableState,
      snapshot: signal,
    });
    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "babysit-factory-pull-request",
        kind: "decision",
        status: needsBabysit ? "success" : "skipped",
        itemId,
        source: "github",
        sourceUrl: item.sourceUrl,
        summary: formatBabysitAuditSummary(
          item.pullRequestNumber,
          needsBabysit
            ? "needs Builder attention for review feedback, CI, or mergeability."
            : "is clean; no Builder feedback request.",
        ),
        details: {
          author: pullRequest.userLogin,
          headSha: pullRequest.headSha,
          checks: snapshot.checks.length,
          comments: snapshot.comments.length,
          unresolvedReviewState,
          mergeable: pullRequest.mergeable,
          mergeableState: pullRequest.mergeableState,
          reviewFeedbackClean: signal.isClean,
        },
      },
      factoryId,
    );
    const now = new Date();
    const nowIso = now.toISOString();
    const metadata = parseTriageMetadata(item.metadataJson);
    const fingerprint = babysitFingerprint({
      headSha: pullRequest.headSha,
      mergeable: pullRequest.mergeable,
      mergeableState: pullRequest.mergeableState,
      snapshot: signal,
      reviewStates: snapshot.reviews.map((review) => review.state),
    });
    const previousFingerprint = metadataString(
      metadata,
      "prBabysitFingerprint",
    );
    const previousState = metadataString(metadata, "prBabysitState");
    if (!needsBabysit) {
      await updateBabysitItem(itemId, orgId, {
        prBabysitState: "clean",
        prBabysitLastCheckedAt: nowIso,
        prBabysitFingerprint: fingerprint,
      });
      return { ok: true, action: "clean" };
    }

    const quietSince =
      previousFingerprint === fingerprint && previousState !== "clean"
        ? (parseTimestamp(metadataString(metadata, "prBabysitQuietSinceAt")) ??
          now.getTime())
        : now.getTime();
    const lastCommentAt = parseTimestamp(
      metadataString(metadata, "prBabysitLastCommentAt"),
    );
    const quietForMs = now.getTime() - quietSince;
    const shouldPost =
      previousFingerprint !== fingerprint &&
      (lastCommentAt === null ||
        now.getTime() - lastCommentAt >= MIN_COMMENT_INTERVAL_MS);
    if (!shouldPost || quietForMs >= QUIET_PERIOD_MS) {
      await updateBabysitItem(itemId, orgId, {
        prBabysitState: quietForMs >= QUIET_PERIOD_MS ? "quiet" : "waiting",
        prBabysitFingerprint: fingerprint,
        prBabysitQuietSinceAt: new Date(quietSince).toISOString(),
        prBabysitLastCheckedAt: nowIso,
      });
      return {
        ok: true,
        action: quietForMs >= QUIET_PERIOD_MS ? "quiet" : "waiting",
        quietForMinutes: Math.floor(Math.max(0, quietForMs) / 60_000),
      };
    }

    const comment = await github.createIssueComment(
      repository,
      item.pullRequestNumber,
      BUILDER_BOT_REQUEST,
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
          "posted the bounded feedback-fix request.",
        ),
        details: {
          author: pullRequest.userLogin,
          commentUrl: comment.htmlUrl,
          quietForMinutes: 0,
        },
      },
      factoryId,
    );
    await updateBabysitItem(itemId, orgId, {
      prBabysitState: "active",
      prBabysitFingerprint: fingerprint,
      prBabysitQuietSinceAt: new Date(quietSince).toISOString(),
      prBabysitLastCheckedAt: nowIso,
      prBabysitLastCommentAt: nowIso,
      prBabysitLastCommentUrl: comment.htmlUrl,
    });
    return {
      ok: true,
      action: "commented",
      commentUrl: comment.htmlUrl,
      quietForMinutes: Math.floor(Math.max(0, quietForMs) / 60_000),
    };
  },
});
