import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import { resolveFactoryRepository } from "../server/lib/factory-repository-scope.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  gitHubRepositoriesEqual,
  parseGitHubRepositoryRef,
} from "../server/lib/github-repository.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  type BabysitEvidenceClient,
  babysitMechanicalVerdict,
  readBabysitEvidence,
  readBabysitStoredState,
} from "../server/triage/babysit-evidence.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import { parseTriageMetadata } from "../server/triage/metadata.js";
import {
  countHumanReviewBodies,
  countHumanReviewComments,
  DEFAULT_BABYSIT_BOT_AUTHORS,
  hasHumanChangesRequested,
  reconcileBabysitState,
} from "../server/triage/pr-babysit.js";
import { detectOwnerOwnedArea } from "../server/triage/pr-policy.js";

export type CreateBabysitEvidenceClient = (identity: {
  ownerEmail: string;
  orgId: string;
}) => BabysitEvidenceClient;

export function createBabysitPullRequestAction(
  createClient: CreateBabysitEvidenceClient = createGitHubClient,
) {
  return defineAction({
    description:
      "Read one pull request and return the babysit briefing: live GitHub evidence, the stored babysit state, how many copies of Factory's hardcoded request are already on the pull request, and the mechanical verdict on whether a ping would be allowed. Read-only: never replies, pushes, merges, or posts. Call this first, then pass a decision of ping, already_asked, or stuck to babysit-factory-pull-request. Refetching in that action is expected; nothing is carried over from here.",
    schema: z.object({
      itemId: z.string().min(1),
      factoryId: factoryIdSchema.optional(),
      failingJobLog: z.string().max(50_000).optional(),
    }),
    http: false,
    readOnly: true,
    run: async (
      { itemId, factoryId: factoryIdInput, failingJobLog },
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
      await requireFactoryAutomation(
        context,
        { userEmail, orgId },
        "prBabysit",
        factoryId,
      );
      if (
        item.source !== "github" ||
        !item.repository ||
        !item.pullRequestNumber
      ) {
        throw new Error("Factory item is not a GitHub pull request.");
      }
      // Same gate as the write twin. A briefing that reads an unconfigured
      // repository would hand the agent evidence it can never act on.
      const configuredRepository = await resolveFactoryRepository(
        db,
        context,
        { userEmail, orgId },
        factoryId,
      );
      if (
        !configuredRepository ||
        !gitHubRepositoriesEqual(configuredRepository, item.repository)
      ) {
        throw new Error(
          "PR babysitting is restricted to the configured Factory repository.",
        );
      }

      const repository = parseGitHubRepositoryRef(item.repository);
      const read = await readBabysitEvidence(
        createClient({ ownerEmail: userEmail, orgId }),
        repository,
        item.pullRequestNumber,
      );
      const stored = readBabysitStoredState(
        parseTriageMetadata(item.metadataJson),
      );
      const base = {
        itemId,
        repository: item.repository,
        pullRequestNumber: item.pullRequestNumber,
        author: read.summary.userLogin,
        stored,
      };
      if (!read.open) {
        return {
          ...base,
          live: {
            state: read.summary.state,
            draft: read.summary.draft,
          },
          mechanical: null,
          proposal: null,
        };
      }

      const { summary, details } = read;
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
      const mechanical = babysitMechanicalVerdict({
        stored,
        summary,
        details,
        proposal,
        nextHumanReviewCommentCount: countHumanReviewComments(details.comments),
        nextHumanReviewBodyCount: countHumanReviewBodies(details.reviews),
        nextChangesRequested: hasHumanChangesRequested(details.reviews),
        nowMs: Date.now(),
      });
      return {
        ...base,
        live: {
          state: summary.state,
          draft: summary.draft,
          headSha: summary.headSha,
          mergeable: summary.mergeable,
          mergeableState: summary.mergeableState,
          mergeabilityComputed: mechanical.mergeability.mergeabilityComputed,
          ownerOwnedArea: detectOwnerOwnedArea([
            item.repository,
            summary.title,
            summary.body,
          ]),
          checksCoverage: details.checksCoverage,
          checks: details.checks.length,
          reviewsTruncated: details.reviewsTruncated,
          commentsTruncated: details.commentsTruncated,
          changesRequested: hasHumanChangesRequested(details.reviews),
        },
        commentScan: {
          babysitCommentCount: details.babysitCommentCount,
          truncated: details.babysitCommentScanTruncated,
        },
        mechanical,
        proposal,
      };
    },
  });
}

export default createBabysitPullRequestAction();
