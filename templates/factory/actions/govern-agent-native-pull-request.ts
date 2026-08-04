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
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { createAiServicesGitReadClient } from "../server/triage/ai-services-git.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import { stableId } from "../server/triage/ids.js";
import {
  parseTriageMetadata,
  serializeTriageMetadata,
} from "../server/triage/metadata.js";
import { reconcileBabysitState } from "../server/triage/pr-babysit.js";
import { decidePullRequestGovernance } from "../server/triage/pr-policy.js";

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
  pullRequestBody: string | null;
  headRef: string;
}): Promise<boolean> {
  const db = getDb();
  const runs = await db
    .select({
      itemId: triageRuns.itemId,
      provider: triageRuns.provider,
      providerTaskId: triageRuns.providerTaskId,
      status: triageRuns.status,
    })
    .from(triageRuns)
    .where(eq(triageRuns.orgId, input.orgId))
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

  if (!body && !input.headRef.startsWith("factory/")) return false;
  const items = await db
    .select({ id: triageItems.id, sourceUrl: triageItems.sourceUrl })
    .from(triageItems)
    .where(eq(triageItems.orgId, input.orgId))
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
    "Govern one agent-native pull request after fetching bounded GitHub and ai-services evidence. Auto-approve only clear internal bug fixes with clean CI and handled review feedback; auto-merge only the verified Factory Builder flow. Clips, Design, and Content are always owner-managed.",
  schema: z.object({
    repo: z.string().trim().min(1).max(256),
    pullRequestNumber: z.number().int().positive(),
    itemId: z.string().min(1).optional(),
    clearBug: z.boolean(),
    productUxImplications: z.boolean().default(false),
    reason: z.string().trim().min(1).max(4_000),
  }),
  http: false,
  run: async (
    {
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
    await requireFactoryAutomation(context, { userEmail, orgId }, "governance");
    const repository = repositoryRef(repo);
    const github = createGitHubClient({ ownerEmail: userEmail, orgId });
    const pullRequest = await github.getPullRequestSummary(
      repository,
      pullRequestNumber,
    );
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

    const checksPassed =
      snapshot.coverage === "complete" &&
      snapshot.checks.length > 0 &&
      snapshot.checks.every((check) => check.state === "passed");
    const reviewStateClean = snapshot.reviews.every(
      (review) =>
        review.state !== "changes_requested" && review.state !== "pending",
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
    const reviewFeedbackHandled = reviewStateClean && reviewFeedback.isClean;
    const internalMember = await github.checkOrganizationMember(
      "BuilderIO",
      pullRequest.userLogin,
    );
    const factoryTriggered = await hasVerifiedFactoryRun({
      itemId,
      orgId,
      pullRequestBody: pullRequest.body,
      headRef: pullRequest.headRef,
    });
    const governance = decidePullRequestGovernance({
      author: pullRequest.userLogin,
      repository: repo,
      title: pullRequest.title,
      summary: pullRequest.body,
      changedFiles: snapshot.changedFiles ?? [],
      clearBug,
      productUxImplications,
      checksPassed,
      reviewFeedbackHandled,
      openNonDraft: pullRequest.state === "open" && !pullRequest.draft,
      internalBuilderMember: internalMember.isMember,
      factoryTriggered,
    });

    if (itemId) {
      const item = (
        await getDb()
          .select()
          .from(triageItems)
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
          .limit(1)
      )[0];
      if (!item) throw new Error("Factory item not found for PR governance.");
      const decisionId = stableId(
        "pr-governance",
        orgId,
        itemId,
        snapshot.headSha,
      );
      await getDb()
        .insert(triageDecisions)
        .values({
          id: decisionId,
          itemId,
          ruleId: null,
          mode: "automation",
          outcome: governance.autoMerge
            ? "auto_merge"
            : governance.autoApprove
              ? "auto_approve"
              : "needs_manual",
          reason: `${reason} ${governance.reason}`.trim(),
          guardResultsJson: JSON.stringify(governance.guardResults),
          model: "factory-pr-governance",
          promptVersion: 1,
          createdAt: new Date().toISOString(),
          ownerEmail: userEmail,
          orgId,
        })
        .onConflictDoNothing();
    }

    if (!governance.autoApprove) {
      if (itemId) {
        await getDb()
          .update(triageItems)
          .set({
            status: governance.ownerOwnedArea ? "needs_manual" : "pr_observed",
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
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
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
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
          "Factory auto-approved: clear internal bug fix with passing CI and handled review feedback.",
        );
        approvalUrl = approval.htmlUrl;
        metadata.autoApprovedAt = new Date().toISOString();
        metadata.autoApprovalUrl = approval.htmlUrl;
        metadata.autoApprovalHeadSha = snapshot.headSha;
        await getDb()
          .update(triageItems)
          .set({
            metadataJson: serializeTriageMetadata(metadata),
            status: "auto_approved",
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
      }
    } else {
      approvalUrl = (
        await github.approvePullRequest(
          repository,
          pullRequestNumber,
          "Factory auto-approved: clear internal bug fix with passing CI and handled review feedback.",
        )
      ).htmlUrl;
    }

    if (!governance.autoMerge) {
      return {
        ok: true,
        action: "approved",
        approvalUrl,
        checksPassed,
        reviewFeedbackHandled,
      };
    }

    const merge = await github.mergePullRequest(
      repository,
      pullRequestNumber,
      `Merge Factory bug fix #${pullRequestNumber}`,
    );
    if (itemId) {
      const item = (
        await getDb()
          .select({ metadataJson: triageItems.metadataJson })
          .from(triageItems)
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
          .limit(1)
      )[0];
      if (!item) throw new Error("Factory item disappeared after PR merge.");
      const metadata = parseTriageMetadata(item.metadataJson);
      metadata.autoMergedAt = new Date().toISOString();
      metadata.mergeSha = merge.sha;
      await getDb()
        .update(triageItems)
        .set({
          metadataJson: serializeTriageMetadata(metadata),
          status: "merged",
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
    }
    return {
      ok: true,
      action: "merged",
      approvalUrl,
      mergeSha: merge.sha,
      checksPassed,
      reviewFeedbackHandled,
    };
  },
});
