import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resolveConnectorSecret } from "../server/connectors/credentials.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { createAiServicesGitReadClient } from "../server/triage/ai-services-git.js";
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

// Same non-secret deployment endpoint/project id the Builder executor reads
// (server/triage/builder-executor.ts); that resolver is private to this file
// and out of scope to export, so this is a second, identical read site for
// the same two env vars rather than a new credential path.
function requiredAiServicesEnv(
  name: "BUILDER_AI_SERVICES_URL" | "BUILDER_PROJECT_ID",
): string {
  const value =
    name === "BUILDER_AI_SERVICES_URL"
      ? process.env.BUILDER_AI_SERVICES_URL // guard:allow-env-credential - non-secret deployment endpoint
      : process.env.BUILDER_PROJECT_ID; // guard:allow-env-credential - non-secret deployment project id
  if (!value) {
    throw new Error(
      `review-comment fetch not configured: ${name} is required to read GitHub review comments.`,
    );
  }
  return value;
}

const fetchReviewCommentsFromAiServices: FetchReviewComments = async ({
  repo,
  pullRequestNumber,
  ownerEmail,
  orgId,
}) => {
  const baseUrl = requiredAiServicesEnv("BUILDER_AI_SERVICES_URL");
  const projectId = requiredAiServicesEnv("BUILDER_PROJECT_ID");
  const privateKey = await resolveConnectorSecret(
    "BUILDER_PRIVATE_KEY",
    ownerEmail,
    { orgId },
  );
  if (!privateKey) {
    throw new Error(
      "review-comment fetch not configured: no Builder executor credential (BUILDER_PRIVATE_KEY) is available for this workspace.",
    );
  }

  const client = createAiServicesGitReadClient({
    baseUrl,
    authorization: `Bearer ${privateKey.startsWith("bpk-") ? privateKey : `bpk-${privateKey}`}`,
  });
  // Review comments ride along on the reviews read; there is no separate
  // comments endpoint in ai-services.
  const snapshot = await client.fetchPullRequest({
    projectId,
    repo,
    pullRequestNumber,
  });
  return {
    comments: snapshot.comments,
    truncated: snapshot.commentsTruncated,
  };
};

export function createBabysitPullRequestAction(
  fetchComments: FetchReviewComments = fetchReviewCommentsFromAiServices,
) {
  return defineAction({
    description:
      "Propose a babysit-PR status (unanswered review comments, failing/pending checks, missing changeset packages) for one pull request. Read-only and proposal-only: never replies, pushes, merges, assigns, or invokes an executor.",
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
