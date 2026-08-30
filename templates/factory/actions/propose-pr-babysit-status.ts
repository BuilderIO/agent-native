import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { parseGitHubRepositoryRef } from "../server/lib/github-repository.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import { reconcileBabysitState } from "../server/triage/pr-babysit.js";
import type {
  ReviewCommentObservation,
  BabysitProposal,
} from "../server/triage/pr-babysit.js";
import type { PullRequestCheckObservation } from "../server/triage/pr-monitor.js";

const checkSchema: z.ZodType<PullRequestCheckObservation> = z.object({
  name: z.string().min(1),
  state: z.enum(["queued", "in_progress", "passed", "failed", "cancelled"]),
  observedAt: z.string().datetime(),
});

export interface FetchReviewCommentsInput {
  repo: string;
  pullRequestNumber: number;
  ownerEmail: string;
  orgId: string;
}

export type FetchReviewComments = (input: FetchReviewCommentsInput) => Promise<{
  comments: readonly ReviewCommentObservation[];
  truncated: boolean;
}>;

const fetchReviewCommentsFromGitHub: FetchReviewComments = async ({
  repo,
  pullRequestNumber,
  ownerEmail,
  orgId,
}) => {
  const github = createGitHubClient({ ownerEmail, orgId });
  const snapshot = await github.listPullRequestReviewComments(
    parseGitHubRepositoryRef(repo),
    pullRequestNumber,
  );
  return {
    comments: snapshot.comments,
    truncated: snapshot.commentsTruncated,
  };
};

export function createBabysitPullRequestAction(
  fetchComments: FetchReviewComments = fetchReviewCommentsFromGitHub,
) {
  return defineAction({
    description:
      "Propose babysit status for one pull request (unanswered review comments, failing or pending checks). Read-only: never replies, pushes, merges, or posts. Use babysit-factory-pull-request when this factory should write the feedback-fix comment.",
    schema: z.object({
      repo: z.string().trim().min(1).max(256),
      pullRequestNumber: z.number().int().positive(),
      checks: z.array(checkSchema).max(500).default([]),
      failingJobLog: z.string().max(50_000).optional(),
      botAuthors: z.array(z.string().trim().min(1)).max(50).optional(),
    }),
    http: false,
    readOnly: true,
    run: async (input, context): Promise<BabysitProposal> => {
      const { userEmail, orgId } = await requireWorkspaceMember(
        workspaceMemberIdentityFromContext(context),
      );
      await requireFactoryAutomation(
        context,
        { userEmail, orgId },
        "prBabysit",
      );
      const { comments, truncated } = await fetchComments({
        repo: input.repo,
        pullRequestNumber: input.pullRequestNumber,
        ownerEmail: userEmail,
        orgId,
      });
      return reconcileBabysitState({
        comments,
        checks: input.checks,
        failingJobLog: input.failingJobLog,
        botAuthors: input.botAuthors,
        commentsTruncated: truncated,
      });
    },
  });
}

export default createBabysitPullRequestAction();
