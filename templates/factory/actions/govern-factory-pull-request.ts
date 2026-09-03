import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  triageDecisions,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  factoryIdSchema,
  orgFactoryItemFilter,
  orgFactoryRunFilter,
  orgFactoryScopedItemWhere,
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
import {
  GitHubRequestError,
  createGitHubClient,
} from "../server/triage/github-client.js";
import { stableId } from "../server/triage/ids.js";
import {
  parseTriageMetadata,
  serializeTriageMetadata,
} from "../server/triage/metadata.js";
import {
  hasCompletePassingChecks,
  reconcileBabysitState,
} from "../server/triage/pr-babysit.js";
import {
  decidePullRequestGovernance,
  hasActiveCredibleSafetyFinding,
  currentPullRequestApprovals,
  FACTORY_APPROVAL_BODY_MARKER,
  hasCurrentBlockingPullRequestReview,
  isUltraScaryChange,
} from "../server/triage/pr-policy.js";

function hasUsableChangedFiles(
  changedFiles: readonly string[] | undefined,
): changedFiles is readonly [string, ...string[]] {
  return (
    Array.isArray(changedFiles) &&
    changedFiles.length > 0 &&
    changedFiles.every(
      (file) => typeof file === "string" && file.trim().length > 0,
    )
  );
}

async function hasVerifiedFactoryRun(input: {
  itemId: string | undefined;
  orgId: string;
  factoryId: string;
  pullRequestBody: string | null;
  headRef: string;
}): Promise<boolean> {
  const db = getDb();
  const runConditions = [orgFactoryRunFilter(input.orgId, input.factoryId)];
  if (input.itemId) {
    runConditions.push(eq(triageRuns.itemId, input.itemId));
  }
  const runs = await db
    .select({
      itemId: triageRuns.itemId,
      provider: triageRuns.provider,
      providerTaskId: triageRuns.providerTaskId,
      status: triageRuns.status,
    })
    .from(triageRuns)
    .where(and(...runConditions))
    .limit(200);
  const verifiedItemIds = new Set(
    runs
      .filter(
        (run) =>
          (run.provider === "builder-http" || run.provider === "bot-tag") &&
          run.status === "completed" &&
          run.providerTaskId !== null,
      )
      .map((run) => run.itemId),
  );
  const body = input.pullRequestBody ?? "";
  if (input.itemId && verifiedItemIds.has(input.itemId)) {
    return (
      input.headRef === `factory/${input.itemId.slice(0, 12)}` ||
      body.includes(`Factory item: ${input.itemId}`)
    );
  }
  if (input.itemId) return false;

  if (!body && !input.headRef.startsWith("factory/")) return false;
  const items = await db
    .select({ id: triageItems.id, sourceUrl: triageItems.sourceUrl })
    .from(triageItems)
    .where(orgFactoryItemFilter(input.orgId, input.factoryId))
    .orderBy(desc(triageItems.updatedAt))
    .limit(100);
  return items.some((item) => {
    if (!verifiedItemIds.has(item.id)) return false;
    return (
      body.includes(`Factory item: ${item.id}`) ||
      (item.sourceUrl !== null && body.includes(item.sourceUrl)) ||
      input.headRef === `factory/${item.id.slice(0, 12)}`
    );
  });
}

export default defineAction({
  description:
    "Govern one pull request in this factory's repository after fetching bounded GitHub review, CI, and changed-file evidence. Auto-approve only under the current review-prs membership, Liam trust, owner, evidence, and ultra-scary gates. Never auto-merge. Clips, Design, and Content feedback remains owner-managed while their verified PR-owner exceptions still apply.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    repo: z.string().trim().min(1).max(256),
    pullRequestNumber: z.number().int().positive(),
    itemId: z.string().min(1),
    clearBug: z.boolean(),
    productUxImplications: z.boolean().default(false),
    reason: z.string().trim().min(1).max(4_000),
  }),
  http: false,
  run: async (
    {
      factoryId,
      repo,
      pullRequestNumber,
      itemId,
      clearBug,
      productUxImplications,
      reason,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "governance",
      factoryId,
    );
    const repository = parseGitHubRepositoryRef(repo);
    const configuredRepository = (
      await readTriageConfigRow(getDb(), orgId, factoryId)
    )?.repository;
    if (
      !configuredRepository ||
      !gitHubRepositoriesEqual(configuredRepository, repo)
    ) {
      throw new Error(
        "PR governance is restricted to the configured Factory repository.",
      );
    }
    if (itemId) {
      const item = (
        await getDb()
          .select({
            repository: triageItems.repository,
            pullRequestNumber: triageItems.pullRequestNumber,
          })
          .from(triageItems)
          .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId))
          .limit(1)
      )[0];
      if (
        !item ||
        !item.repository ||
        !gitHubRepositoriesEqual(item.repository, repo) ||
        item.pullRequestNumber !== pullRequestNumber
      ) {
        throw new Error(
          "Factory item does not match the governed repository and pull request.",
        );
      }
    }
    const github = createGitHubClient({ ownerEmail: userEmail, orgId });
    const pullRequest = await github.getPullRequestSummary(
      repository,
      pullRequestNumber,
    );
    if (pullRequest.state !== "open" || pullRequest.draft) {
      if (itemId) {
        await getDb()
          .update(triageItems)
          .set({
            status: "pr_observed",
            updatedAt: new Date().toISOString(),
          })
          .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
      }
      return {
        ok: true,
        action: "skipped",
        reason: pullRequest.draft
          ? "Pull request is a draft and is excluded before evidence review."
          : "Pull request is not open and is excluded before evidence review.",
      };
    }
    const reconcileClaim = async (headSha: string, reason: string) => {
      if (!itemId) return;
      await getDb().transaction(async (tx) => {
        const released = await tx
          .update(triageDecisions)
          .set({ outcome: "needs_manual", reason })
          .where(
            and(
              eq(
                triageDecisions.id,
                stableId("pr-governance", orgId, itemId, headSha),
              ),
              eq(triageDecisions.itemId, itemId),
              eq(triageDecisions.orgId, orgId),
              eq(triageDecisions.factoryId, factoryId),
              eq(triageDecisions.outcome, "auto_approval_claimed"),
            ),
          )
          .returning({ id: triageDecisions.id });
        if (!released[0]) return;
        await tx
          .update(triageItems)
          .set({
            status: "reconciliation_required",
            updatedAt: new Date().toISOString(),
          })
          .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
      });
    };
    const [snapshot, changedFiles] = await Promise.all([
      github.getPullRequestEvidence(
        repository,
        pullRequestNumber,
        pullRequest.headSha,
      ),
      github.listPullRequestChangedFiles(repository, pullRequestNumber),
    ]);
    const blockingReviewStatesClean = !hasCurrentBlockingPullRequestReview(
      snapshot.reviews,
      pullRequest.headSha,
    );
    const safetyFindingsClean =
      !snapshot.commentsTruncated &&
      !snapshot.reviewsTruncated &&
      !hasActiveCredibleSafetyFinding(snapshot.reviews, snapshot.comments);
    let currentApprovals;
    try {
      currentApprovals = currentPullRequestApprovals(
        snapshot.reviews,
        pullRequest.headSha,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "unknown approval evidence error";
      await reconcileClaim(
        pullRequest.headSha,
        `Approval evidence could not be verified: ${message}. Reconciliation is required before approval.`,
      );
      throw error;
    }
    const currentApproval = currentApprovals[0] ?? null;
    if (!hasUsableChangedFiles(changedFiles)) {
      const missingFilesReason =
        "Changed-file evidence is missing or invalid; approval requires reconciliation before retrying.";
      await reconcileClaim(pullRequest.headSha, missingFilesReason);
      await getDb()
        .update(triageItems)
        .set({
          status: "needs_manual",
          updatedAt: new Date().toISOString(),
        })
        .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
      return { ok: true, action: "needs_manual", reason: missingFilesReason };
    }
    if (currentApproval) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "govern-factory-pull-request",
          kind: "governance",
          status: "skipped",
          itemId: itemId ?? null,
          source: "github",
          sourceUrl: pullRequest.htmlUrl,
          summary:
            "Skipped the pull request because it already has a current non-dismissed approval.",
          details: { repo, pullRequestNumber },
        },
        factoryId,
      );
      let recoveredApproval = false;
      let previouslyFinalized = false;
      if (itemId) {
        const existingItem = (
          await getDb()
            .select({
              metadataJson: triageItems.metadataJson,
              status: triageItems.status,
            })
            .from(triageItems)
            .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId))
            .limit(1)
        )[0];
        if (!existingItem) {
          throw new Error("Factory item disappeared during approval recovery.");
        }
        const existingMetadata = parseTriageMetadata(existingItem.metadataJson);
        let livePullRequest;
        try {
          livePullRequest = await github.getPullRequestSummary(
            repository,
            pullRequestNumber,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown GitHub error";
          await reconcileClaim(
            pullRequest.headSha,
            `Live GitHub state could not be revalidated during approval recovery: ${message}. Reconciliation is required before approval.`,
          );
          throw error;
        }
        if (
          livePullRequest.headSha !== pullRequest.headSha ||
          livePullRequest.state !== "open" ||
          livePullRequest.draft
        ) {
          await reconcileClaim(
            pullRequest.headSha,
            "Live GitHub pull-request state changed during approval recovery; reconciliation is required before approval.",
          );
          return {
            ok: true,
            action: "needs_manual",
            reason:
              "Live GitHub pull-request state changed during approval recovery; no approval state was finalized.",
          };
        }
        previouslyFinalized =
          existingItem.status === "auto_approved" &&
          existingMetadata.autoApprovalHeadSha === pullRequest.headSha &&
          typeof existingMetadata.autoApprovalUrl === "string";
        const decisionId = stableId(
          "pr-governance",
          orgId,
          itemId,
          pullRequest.headSha,
        );
        if (previouslyFinalized) {
          await getDb()
            .update(triageDecisions)
            .set({ outcome: "auto_approve" })
            .where(
              and(
                eq(triageDecisions.id, decisionId),
                eq(triageDecisions.itemId, itemId),
                eq(triageDecisions.orgId, orgId),
                eq(triageDecisions.factoryId, factoryId),
                eq(triageDecisions.outcome, "auto_approval_claimed"),
              ),
            );
        }
        const authenticatedUser = await github.getAuthenticatedUser();
        const currentAuthorMembership =
          await github.checkOrganizationMemberById(
            "BuilderIO",
            pullRequest.userId,
            pullRequest.userLogin,
          );
        const attributedApproval = currentApprovals.find(
          (approval) =>
            approval.reviewerLogin ===
              authenticatedUser.login.trim().toLowerCase() &&
            approval.body?.startsWith(
              `${FACTORY_APPROVAL_BODY_MARKER}${decisionId};`,
            ),
        );
        const attributedApprovalUrl =
          attributedApproval?.htmlUrl ?? pullRequest.htmlUrl;
        if (
          attributedApproval &&
          currentAuthorMembership.isMember &&
          blockingReviewStatesClean &&
          safetyFindingsClean &&
          hasUsableChangedFiles(changedFiles) &&
          !isUltraScaryChange(changedFiles)
        ) {
          recoveredApproval = await getDb().transaction(async (tx) => {
            const recovered = await tx
              .update(triageDecisions)
              .set({ outcome: "auto_approve" })
              .where(
                and(
                  eq(triageDecisions.id, decisionId),
                  eq(triageDecisions.itemId, itemId),
                  eq(triageDecisions.orgId, orgId),
                  eq(triageDecisions.factoryId, factoryId),
                  eq(triageDecisions.outcome, "auto_approval_claimed"),
                ),
              )
              .returning({ id: triageDecisions.id });
            if (!recovered[0]) return false;
            const latestItem = (
              await tx
                .select({ metadataJson: triageItems.metadataJson })
                .from(triageItems)
                .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId))
                .limit(1)
            )[0];
            if (!latestItem) {
              throw new Error(
                "Factory item disappeared during approval recovery.",
              );
            }
            const metadata = parseTriageMetadata(latestItem.metadataJson);
            metadata.autoApprovedAt = new Date().toISOString();
            metadata.autoApprovalUrl = attributedApprovalUrl;
            metadata.autoApprovalHeadSha = pullRequest.headSha;
            await tx
              .update(triageItems)
              .set({
                metadataJson: serializeTriageMetadata(metadata),
                status: "auto_approved",
                updatedAt: new Date().toISOString(),
              })
              .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
            return true;
          });
        }
        if (recoveredApproval) {
          await recordFactoryAudit(
            context,
            { userEmail, orgId },
            {
              action: "govern-factory-pull-request",
              kind: "external_action",
              status: "success",
              itemId,
              source: "github",
              sourceUrl: attributedApprovalUrl,
              summary:
                "Recovered the attributed Factory approval after an ambiguous provider result.",
              details: {
                repo,
                pullRequestNumber,
                decisionId,
                approvalUrl: attributedApprovalUrl,
              },
            },
            factoryId,
          );
        }
      }
      if (itemId && !recoveredApproval && !previouslyFinalized) {
        const uncorrelatedClaim = await getDb()
          .update(triageDecisions)
          .set({
            outcome: "needs_manual",
            reason:
              "A current approval could not be correlated to the Factory claim; reconciliation is required.",
          })
          .where(
            and(
              eq(
                triageDecisions.id,
                stableId("pr-governance", orgId, itemId, pullRequest.headSha),
              ),
              eq(triageDecisions.itemId, itemId),
              eq(triageDecisions.orgId, orgId),
              eq(triageDecisions.factoryId, factoryId),
              eq(triageDecisions.outcome, "auto_approval_claimed"),
            ),
          )
          .returning({ id: triageDecisions.id });
        if (uncorrelatedClaim[0]) {
          await getDb()
            .update(triageItems)
            .set({
              status: "reconciliation_required",
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                orgFactoryScopedItemWhere(itemId, orgId, factoryId),
                ne(triageItems.status, "auto_approved"),
              ),
            );
        }
      }
      return {
        ok: true,
        action: "skipped",
        reason:
          "Pull request already has a current non-dismissed approval; no duplicate review was created.",
      };
    }

    const checksPassed = hasCompletePassingChecks(snapshot);
    const reviewFeedback = reconcileBabysitState({
      comments: snapshot.comments,
      checks: snapshot.checks,
      checksCoverage: snapshot.checksCoverage,
      commentsTruncated: snapshot.commentsTruncated,
      reviews: snapshot.reviews,
      reviewsTruncated: snapshot.reviewsTruncated,
      botAuthors: [
        "github-actions",
        "github-actions[bot]",
        "dependabot[bot]",
        "builderio[bot]",
      ],
    });
    const reviewFeedbackHandled =
      blockingReviewStatesClean && reviewFeedback.isClean;
    const internalMember = await github.checkOrganizationMember(
      "BuilderIO",
      pullRequest.userLogin,
    );
    const factoryTriggered = await hasVerifiedFactoryRun({
      itemId,
      orgId,
      factoryId,
      pullRequestBody: pullRequest.body,
      headRef: pullRequest.headRef,
    });
    const governance = decidePullRequestGovernance({
      author: pullRequest.userLogin,
      authorId: pullRequest.userId,
      repository: repo,
      title: pullRequest.title,
      summary: pullRequest.body,
      changedFiles: changedFiles,
      clearBug,
      productUxImplications,
      checksPassed,
      reviewFeedbackHandled,
      blockingReviewStatesClean,
      safetyFindingsClean,
      openNonDraft: pullRequest.state === "open" && !pullRequest.draft,
      internalBuilderMember: internalMember.isMember,
      factoryTriggered,
      checksCoverage: snapshot.checksCoverage,
    });

    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "govern-factory-pull-request",
        kind: "governance",
        status: "skipped",
        itemId: itemId ?? null,
        source: "github",
        sourceUrl: pullRequest.htmlUrl,
        summary: governance.reason,
        details: {
          repo,
          pullRequestNumber,
          clearBug,
          productUxImplications,
          internalBuilderMember: internalMember.isMember,
          factoryTriggered,
          checksPassed,
          reviewFeedbackHandled,
          autoApprove: governance.autoApprove,
          autoMerge: governance.autoMerge,
          ownerException: governance.ownerException,
          trustException: governance.trustException,
          ownerOwnedArea: governance.ownerOwnedArea ?? null,
          guardResults: governance.guardResults,
        },
      },
      factoryId,
    );

    if (itemId) {
      const item = (
        await getDb()
          .select()
          .from(triageItems)
          .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId))
          .limit(1)
      )[0];
      if (!item) throw new Error("Factory item not found for PR governance.");
      const decisionId = stableId(
        "pr-governance",
        orgId,
        itemId,
        pullRequest.headSha,
      );
      await getDb().transaction(async (tx) => {
        const inserted = await tx
          .insert(triageDecisions)
          .values({
            id: decisionId,
            itemId,
            ruleId: null,
            mode: "automation",
            outcome: governance.autoMerge
              ? "auto_merge"
              : governance.autoApprove
                ? "auto_approval_claimed"
                : "needs_manual",
            reason: `${reason} ${governance.reason}`.trim(),
            guardResultsJson: JSON.stringify(governance.guardResults),
            model: "factory-pr-governance",
            promptVersion: 1,
            createdAt: new Date().toISOString(),
            ownerEmail: userEmail,
            orgId,
            factoryId,
          })
          .onConflictDoNothing()
          .returning({ id: triageDecisions.id });
        if (governance.autoApprove && !inserted[0]) {
          const staleFinalized = await tx
            .update(triageDecisions)
            .set({
              outcome: "needs_manual",
              reason:
                "A previously posted Factory approval was dismissed; reconciliation is required before retrying.",
            })
            .where(
              and(
                eq(triageDecisions.id, decisionId),
                eq(triageDecisions.itemId, itemId),
                eq(triageDecisions.orgId, orgId),
                eq(triageDecisions.factoryId, factoryId),
                eq(triageDecisions.outcome, "auto_approve"),
              ),
            )
            .returning({ id: triageDecisions.id });
          if (staleFinalized[0]) {
            await tx
              .update(triageItems)
              .set({
                status: "reconciliation_required",
                updatedAt: new Date().toISOString(),
              })
              .where(
                and(
                  orgFactoryScopedItemWhere(itemId, orgId, factoryId),
                  eq(triageItems.status, "auto_approved"),
                ),
              );
          }
          const reclaimed = await tx
            .update(triageDecisions)
            .set({
              outcome: "auto_approval_claimed",
              reason: `${reason} ${governance.reason}`.trim(),
              guardResultsJson: JSON.stringify(governance.guardResults),
              createdAt: new Date().toISOString(),
              ownerEmail: userEmail,
            })
            .where(
              and(
                eq(triageDecisions.id, decisionId),
                eq(triageDecisions.itemId, itemId),
                eq(triageDecisions.orgId, orgId),
                eq(triageDecisions.factoryId, factoryId),
                eq(triageDecisions.outcome, "needs_manual"),
              ),
            )
            .returning({ id: triageDecisions.id });
          if (!reclaimed[0]) {
            throw new Error(
              "A pull-request approval intent already exists; reconcile the provider result before retrying.",
            );
          }
        }
        await requireExistingFactory(
          tx as unknown as ReturnType<typeof getDb>,
          orgId,
          factoryId,
        );
      });
    }

    if (!governance.autoApprove) {
      if (itemId) {
        await getDb()
          .update(triageItems)
          .set({
            status: governance.ownerOwnedArea ? "needs_manual" : "pr_observed",
            updatedAt: new Date().toISOString(),
          })
          .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
      }
      return {
        ok: true,
        action: "needs_manual",
        ownerOwnedArea: governance.ownerOwnedArea,
        reason: governance.reason,
        checksPassed,
        reviewFeedbackHandled,
      };
    }

    if (itemId) {
      let postClaimSnapshot: Awaited<
        ReturnType<typeof github.getPullRequestEvidence>
      >;
      let postClaimChangedFiles: readonly string[];
      let postClaimPullRequest = pullRequest;
      try {
        postClaimPullRequest = await github.getPullRequestSummary(
          repository,
          pullRequestNumber,
        );
        if (postClaimPullRequest.headSha !== pullRequest.headSha) {
          throw new Error(
            `PR evidence changed after approval claim: expected ${pullRequest.headSha}, received ${postClaimPullRequest.headSha}.`,
          );
        }
        [postClaimSnapshot, postClaimChangedFiles] = await Promise.all([
          github.getPullRequestEvidence(
            repository,
            pullRequestNumber,
            postClaimPullRequest.headSha,
          ),
          github.listPullRequestChangedFiles(repository, pullRequestNumber),
        ]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown evidence error";
        await reconcileClaim(
          pullRequest.headSha,
          `Post-claim PR evidence could not be verified: ${message}. Reconciliation is required before approval.`,
        );
        throw error;
      }
      const postClaimBlockingReviewStatesClean =
        !hasCurrentBlockingPullRequestReview(
          postClaimSnapshot.reviews,
          pullRequest.headSha,
        );
      const postClaimSafetyFindingsClean =
        !postClaimSnapshot.commentsTruncated &&
        !postClaimSnapshot.reviewsTruncated &&
        !hasActiveCredibleSafetyFinding(
          postClaimSnapshot.reviews,
          postClaimSnapshot.comments,
        );
      if (!hasUsableChangedFiles(postClaimChangedFiles)) {
        await reconcileClaim(
          pullRequest.headSha,
          "Changed-file evidence disappeared after approval claim; reconciliation is required before approval.",
        );
        return {
          ok: true,
          action: "needs_manual",
          reason:
            "Changed-file evidence disappeared after approval claim; no approval was posted.",
        };
      }
      const postClaimChecksPassed = hasCompletePassingChecks(postClaimSnapshot);
      const postClaimReviewFeedback = reconcileBabysitState({
        comments: postClaimSnapshot.comments,
        checks: postClaimSnapshot.checks,
        checksCoverage: postClaimSnapshot.checksCoverage,
        commentsTruncated: postClaimSnapshot.commentsTruncated,
        reviews: postClaimSnapshot.reviews,
        reviewsTruncated: postClaimSnapshot.reviewsTruncated,
        botAuthors: [
          "github-actions",
          "github-actions[bot]",
          "dependabot[bot]",
          "builderio[bot]",
        ],
      });
      const postClaimReviewFeedbackHandled =
        postClaimBlockingReviewStatesClean && postClaimReviewFeedback.isClean;
      const postClaimInternalMember = await github.checkOrganizationMemberById(
        "BuilderIO",
        pullRequest.userId,
        pullRequest.userLogin,
      );
      const postClaimGovernance = decidePullRequestGovernance({
        author: pullRequest.userLogin,
        authorId: pullRequest.userId,
        repository: repo,
        title: postClaimPullRequest.title,
        summary: postClaimPullRequest.body,
        changedFiles: postClaimChangedFiles,
        clearBug,
        productUxImplications,
        checksPassed: postClaimChecksPassed,
        reviewFeedbackHandled: postClaimReviewFeedbackHandled,
        blockingReviewStatesClean: postClaimBlockingReviewStatesClean,
        safetyFindingsClean: postClaimSafetyFindingsClean,
        openNonDraft: pullRequest.state === "open" && !pullRequest.draft,
        internalBuilderMember: postClaimInternalMember.isMember,
        factoryTriggered,
        checksCoverage: postClaimSnapshot.checksCoverage,
      });
      if (!postClaimGovernance.autoApprove) {
        await reconcileClaim(
          pullRequest.headSha,
          `Post-claim PR evidence no longer satisfies the approval gates: ${postClaimGovernance.reason}`,
        );
        return {
          ok: true,
          action: "needs_manual",
          reason:
            "Post-claim PR evidence no longer satisfies the approval gates; reconciliation is required.",
        };
      }
      let postClaimApprovals;
      try {
        postClaimApprovals = currentPullRequestApprovals(
          postClaimSnapshot.reviews,
          pullRequest.headSha,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "unknown approval evidence error";
        await reconcileClaim(
          pullRequest.headSha,
          `Post-claim approval evidence could not be verified: ${message}. Reconciliation is required before approval.`,
        );
        throw error;
      }
      if (postClaimApprovals.length > 0) {
        await getDb().transaction(async (tx) => {
          await tx
            .update(triageDecisions)
            .set({
              outcome: "needs_manual",
              reason:
                "A current approval appeared after the Factory claim; reconciliation is required before posting another review.",
            })
            .where(
              and(
                eq(
                  triageDecisions.id,
                  stableId("pr-governance", orgId, itemId, pullRequest.headSha),
                ),
                eq(triageDecisions.itemId, itemId),
                eq(triageDecisions.orgId, orgId),
                eq(triageDecisions.factoryId, factoryId),
                eq(triageDecisions.outcome, "auto_approval_claimed"),
              ),
            );
          await tx
            .update(triageItems)
            .set({
              status: "reconciliation_required",
              updatedAt: new Date().toISOString(),
            })
            .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
        });
        return {
          ok: true,
          action: "needs_manual",
          reason:
            "A current approval appeared after the Factory claim; no duplicate review was created.",
        };
      }
    }

    let approvalUrl: string | null = null;
    if (itemId) {
      const item = (
        await getDb()
          .select({
            metadataJson: triageItems.metadataJson,
            status: triageItems.status,
          })
          .from(triageItems)
          .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId))
          .limit(1)
      )[0];
      if (!item) throw new Error("Factory item disappeared after PR approval.");
      const metadata = parseTriageMetadata(item.metadataJson);
      const previouslyApproved =
        item.status === "auto_approved" &&
        metadata.autoApprovalHeadSha === pullRequest.headSha &&
        typeof metadata.autoApprovalUrl === "string";
      if (previouslyApproved) approvalUrl = metadata.autoApprovalUrl as string;
      if (!previouslyApproved) {
        let livePullRequest;
        try {
          livePullRequest = await github.getPullRequestSummary(
            repository,
            pullRequestNumber,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown GitHub error";
          await reconcileClaim(
            pullRequest.headSha,
            `Live GitHub state could not be revalidated: ${message}. Reconciliation is required before approval.`,
          );
          throw error;
        }
        if (
          livePullRequest.headSha !== pullRequest.headSha ||
          livePullRequest.state !== "open" ||
          livePullRequest.draft
        ) {
          await reconcileClaim(
            pullRequest.headSha,
            "Live GitHub pull-request state changed after review; reconciliation is required before approval.",
          );
          return {
            ok: true,
            action: "needs_manual",
            reason:
              "Live GitHub pull-request state changed after review; no approval was posted.",
          };
        }
        let finalReviewSnapshot;
        try {
          const finalPullRequest = await github.getPullRequestSummary(
            repository,
            pullRequestNumber,
          );
          if (finalPullRequest.headSha !== pullRequest.headSha) {
            throw new Error(
              `PR review evidence changed before approval: expected ${pullRequest.headSha}, received ${finalPullRequest.headSha}.`,
            );
          }
          finalReviewSnapshot = await github.getPullRequestEvidence(
            repository,
            pullRequestNumber,
            finalPullRequest.headSha,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "unknown review evidence error";
          await reconcileClaim(
            pullRequest.headSha,
            `Review evidence could not be revalidated before approval: ${message}. Reconciliation is required before approval.`,
          );
          throw error;
        }
        let finalApprovals;
        try {
          finalApprovals = currentPullRequestApprovals(
            finalReviewSnapshot.reviews,
            pullRequest.headSha,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "unknown approval evidence error";
          await reconcileClaim(
            pullRequest.headSha,
            `Approval evidence could not be revalidated before approval: ${message}. Reconciliation is required before approval.`,
          );
          throw error;
        }
        if (
          finalApprovals.length > 0 ||
          hasCurrentBlockingPullRequestReview(
            finalReviewSnapshot.reviews,
            pullRequest.headSha,
          ) ||
          !hasCompletePassingChecks(finalReviewSnapshot) ||
          finalReviewSnapshot.commentsTruncated ||
          finalReviewSnapshot.reviewsTruncated ||
          hasActiveCredibleSafetyFinding(
            finalReviewSnapshot.reviews,
            finalReviewSnapshot.comments,
          )
        ) {
          await reconcileClaim(
            pullRequest.headSha,
            "Review evidence changed before approval; reconciliation is required before retrying.",
          );
          return {
            ok: true,
            action: "needs_manual",
            reason:
              "Review evidence changed before approval; no duplicate or unsafe approval was posted.",
          };
        }
        const decisionId = stableId(
          "pr-governance",
          orgId,
          itemId,
          pullRequest.headSha,
        );
        let approval: Awaited<ReturnType<typeof github.approvePullRequest>>;
        try {
          approval = await github.approvePullRequest(
            repository,
            pullRequestNumber,
            governance.trustException
              ? `Factory auto-approved under decision ${decisionId}; verified ${governance.trustException} trust exception; ordinary check and review states remain recorded.`
              : governance.ownerException
                ? `Factory auto-approved under decision ${decisionId}; verified ${governance.ownerException} owner exception; ordinary check and review states remain recorded.`
                : `Factory auto-approved under decision ${decisionId}; verified BuilderIO membership; ordinary check and review states remain recorded.`,
            pullRequest.headSha,
          );
        } catch (error) {
          if (error instanceof GitHubRequestError) {
            const definitiveRejection =
              error.status !== null &&
              error.status >= 400 &&
              error.status < 500 &&
              !error.rateLimited;
            const claimCanBeReleased =
              definitiveRejection || !error.requestAttempted;
            if (claimCanBeReleased) {
              const rejectionReason = definitiveRejection
                ? `GitHub rejected the approval request definitively: ${error.message}`
                : `GitHub approval request was unavailable before the provider call: ${error.message}`;
              await getDb().transaction(async (tx) => {
                const released = await tx
                  .update(triageDecisions)
                  .set({ outcome: "needs_manual", reason: rejectionReason })
                  .where(
                    and(
                      eq(
                        triageDecisions.id,
                        stableId(
                          "pr-governance",
                          orgId,
                          itemId,
                          pullRequest.headSha,
                        ),
                      ),
                      eq(triageDecisions.itemId, itemId),
                      eq(triageDecisions.orgId, orgId),
                      eq(triageDecisions.factoryId, factoryId),
                      eq(triageDecisions.outcome, "auto_approval_claimed"),
                    ),
                  )
                  .returning({ id: triageDecisions.id });
                if (released[0] && definitiveRejection) {
                  await tx
                    .update(triageItems)
                    .set({
                      status: "needs_manual",
                      updatedAt: new Date().toISOString(),
                    })
                    .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
                }
              });
              if (definitiveRejection) {
                await recordFactoryAudit(
                  context,
                  { userEmail, orgId },
                  {
                    action: "govern-factory-pull-request",
                    kind: "external_action",
                    status: "error",
                    itemId,
                    source: "github",
                    sourceUrl: pullRequest.htmlUrl,
                    summary: rejectionReason,
                    details: {
                      repo,
                      pullRequestNumber,
                      status: error.status,
                    },
                  },
                  factoryId,
                );
              }
            }
          }
          throw error;
        }
        approvalUrl = approval.htmlUrl;
        let postApprovalPullRequest;
        try {
          postApprovalPullRequest = await github.getPullRequestSummary(
            repository,
            pullRequestNumber,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown GitHub error";
          await reconcileClaim(
            pullRequest.headSha,
            `Live GitHub state could not be revalidated after approval: ${message}. Reconciliation is required before finalizing.`,
          );
          throw error;
        }
        if (postApprovalPullRequest.headSha !== pullRequest.headSha) {
          await reconcileClaim(
            pullRequest.headSha,
            "The pull request changed after approval was posted; reconciliation is required before finalizing.",
          );
          return {
            ok: true,
            action: "needs_manual",
            reason:
              "The pull request changed after approval was posted; durable approval state was not finalized.",
          };
        }
        const latestItem = (
          await getDb()
            .select({ metadataJson: triageItems.metadataJson })
            .from(triageItems)
            .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId))
            .limit(1)
        )[0];
        if (!latestItem) {
          throw new Error("Factory item disappeared after GitHub approval.");
        }
        const latestMetadata = parseTriageMetadata(latestItem.metadataJson);
        latestMetadata.autoApprovedAt = new Date().toISOString();
        latestMetadata.autoApprovalUrl = approval.htmlUrl;
        latestMetadata.autoApprovalHeadSha = pullRequest.headSha;
        await getDb()
          .update(triageItems)
          .set({
            metadataJson: serializeTriageMetadata(latestMetadata),
            status: "auto_approved",
            updatedAt: new Date().toISOString(),
          })
          .where(orgFactoryScopedItemWhere(itemId, orgId, factoryId));
        await getDb()
          .update(triageDecisions)
          .set({ outcome: "auto_approve" })
          .where(
            and(
              eq(
                triageDecisions.id,
                stableId("pr-governance", orgId, itemId, pullRequest.headSha),
              ),
              eq(triageDecisions.itemId, itemId),
              eq(triageDecisions.orgId, orgId),
              eq(triageDecisions.factoryId, factoryId),
              eq(triageDecisions.outcome, "auto_approval_claimed"),
            ),
          );
      }
    } else {
      throw new Error(
        "PR governance requires a Factory item for an atomic approval claim.",
      );
    }

    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "govern-factory-pull-request",
        kind: "external_action",
        itemId: itemId ?? null,
        source: "github",
        sourceUrl: approvalUrl,
        summary:
          "Approved the pull request under the current review-prs policy.",
        details: { repo, pullRequestNumber, approvalUrl },
      },
      factoryId,
    );
    return {
      ok: true,
      action: "approved",
      approvalUrl,
      checksPassed,
      reviewFeedbackHandled,
    };
  },
});
