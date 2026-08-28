import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { resolveConnectorSecret } from "../server/connectors/credentials.js";
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
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { createAiServicesGitReadClient } from "../server/triage/ai-services-git.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import { stableId } from "../server/triage/ids.js";
import {
  parseTriageMetadata,
  serializeTriageMetadata,
} from "../server/triage/metadata.js";
import { reconcileBabysitState } from "../server/triage/pr-babysit.js";
import {
  decidePullRequestGovernance,
  hasCurrentBlockingPullRequestReview,
  hasCurrentPullRequestApproval,
} from "../server/triage/pr-policy.js";

function repositoryRef(value: string): { owner: string; repo: string } {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value.trim());
  if (!match)
    throw new Error("Repository must use the owner/repository format.");
  return { owner: match[1], repo: match[2] };
}

function requiredAiServicesEnv(
  name: "BUILDER_AI_SERVICES_URL" | "BUILDER_PROJECT_ID",
): string {
  const value =
    name === "BUILDER_AI_SERVICES_URL"
      ? process.env.BUILDER_AI_SERVICES_URL // guard:allow-env-credential - non-secret deployment endpoint
      : process.env.BUILDER_PROJECT_ID; // guard:allow-env-credential - non-secret deployment project id
  if (!value) throw new Error(`${name} is required for PR governance.`);
  return value;
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
    "Govern one agent-native pull request after fetching bounded GitHub and ai-services evidence. Auto-approve only under the current review-prs membership, Liam trust, owner, evidence, and ultra-scary gates. Never auto-merge. Clips, Design, and Content feedback remains owner-managed while their verified PR-owner exceptions still apply.",
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
    const repository = repositoryRef(repo);
    const configuredRepository = (
      await readTriageConfigRow(getDb(), orgId, factoryId)
    )?.repository;
    if (!configuredRepository || configuredRepository.trim() !== repo.trim()) {
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
        item.repository !== repo.trim() ||
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
    const privateKey = await resolveConnectorSecret(
      "BUILDER_PRIVATE_KEY",
      userEmail,
      { orgId },
    );
    if (!privateKey)
      throw new Error(
        "BUILDER_PRIVATE_KEY is required to read PR review evidence.",
      );
    const projectId = requiredAiServicesEnv("BUILDER_PROJECT_ID");
    const snapshot = await createAiServicesGitReadClient({
      baseUrl: requiredAiServicesEnv("BUILDER_AI_SERVICES_URL"),
      authorization: `Bearer ${privateKey.startsWith("bpk-") ? privateKey : `bpk-${privateKey}`}`,
    }).fetchPullRequest({ projectId, repo, pullRequestNumber });
    if (snapshot.headSha !== pullRequest.headSha) {
      throw new Error(
        `PR evidence is stale: GitHub reports ${pullRequest.headSha}, ai-services reports ${snapshot.headSha}.`,
      );
    }
    if (hasCurrentPullRequestApproval(snapshot.reviews, snapshot.headSha)) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "govern-agent-native-pull-request",
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
      if (itemId) {
        const decisionId = stableId(
          "pr-governance",
          orgId,
          itemId,
          snapshot.headSha,
        );
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
        reason:
          "Pull request already has a current non-dismissed approval; no duplicate review was created.",
      };
    }

    const checksPassed =
      snapshot.coverage === "complete" &&
      snapshot.checks.length > 0 &&
      snapshot.checks.every((check) => check.state === "passed");
    const blockingReviewStatesClean = !hasCurrentBlockingPullRequestReview(
      snapshot.reviews,
    );
    const reviewFeedback = reconcileBabysitState({
      comments: snapshot.comments,
      checks: snapshot.checks,
      commentsTruncated: snapshot.commentsTruncated,
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
      changedFiles: snapshot.changedFiles ?? [],
      clearBug,
      productUxImplications,
      checksPassed,
      reviewFeedbackHandled,
      blockingReviewStatesClean,
      openNonDraft: pullRequest.state === "open" && !pullRequest.draft,
      internalBuilderMember: internalMember.isMember,
      factoryTriggered,
    });

    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "govern-agent-native-pull-request",
        kind: "governance",
        status: governance.autoApprove ? "success" : "skipped",
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
        snapshot.headSha,
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
        metadata.autoApprovalHeadSha === snapshot.headSha &&
        typeof metadata.autoApprovalUrl === "string";
      if (previouslyApproved) approvalUrl = metadata.autoApprovalUrl as string;
      if (!previouslyApproved) {
        const approval = await github.approvePullRequest(
          repository,
          pullRequestNumber,
          governance.trustException
            ? `Factory auto-approved under the verified ${governance.trustException} trust exception; ordinary check and review states remain recorded.`
            : governance.ownerException
              ? `Factory auto-approved under the verified ${governance.ownerException} owner exception; ordinary check and review states remain recorded.`
              : "Factory auto-approved under verified BuilderIO membership; ordinary check and review states remain recorded.",
        );
        approvalUrl = approval.htmlUrl;
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
        latestMetadata.autoApprovalHeadSha = snapshot.headSha;
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
                stableId("pr-governance", orgId, itemId, snapshot.headSha),
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
        action: "govern-agent-native-pull-request",
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
