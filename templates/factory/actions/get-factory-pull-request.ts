import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  parseRepositoryInput,
  readPullRequestEvidence,
} from "../server/lib/factory-pull-request.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
  assertResultWithinLimit,
  requireWorkflowActionCaller,
  takeWithinBudget,
} from "../server/lib/workflow-action-support.js";
import { createGitHubClient } from "../server/triage/github-client.js";

const CHECKS_LISTED = 60;
const THREADS_LISTED = 20;

export default defineAction({
  description:
    "Read one pull request for a workflow: its state, the checks on its head commit, its unresolved review threads, and whether a Builder account opened it. Review threads come from GitHub's thread data; if that cannot be read the call fails rather than reporting no threads. Lists are bounded and say truncated when cut.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    repo: z.string().trim().min(1).max(256),
    number: z.number().int().positive(),
  }),
  http: false,
  mcpTool: false,
  readOnly: true,
  run: async ({ factoryId: requestedFactoryId, repo, number }, context) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    const repository = parseRepositoryInput(repo);
    const github = createGitHubClient({
      ownerEmail: caller.userEmail,
      orgId: caller.orgId,
    });
    const evidence = await readPullRequestEvidence(github, repository, number);
    const { summary } = evidence;
    const unresolved = evidence.threads.filter((thread) => !thread.resolved);
    const counts = { passed: 0, failed: 0, pending: 0, informational: 0 };
    for (const check of evidence.checks) {
      if (check.state === "passed") counts.passed += 1;
      else if (check.state === "failed" || check.state === "cancelled")
        counts.failed += 1;
      else if (check.state === "queued" || check.state === "in_progress")
        counts.pending += 1;
      else counts.informational += 1;
    }
    const notPassing = evidence.checks
      .filter((check) => check.state !== "passed")
      .map((check) => ({
        name: check.name.slice(0, 120),
        state: check.state,
      }));
    const threadList = takeWithinBudget(
      unresolved.slice(0, THREADS_LISTED),
      WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS / 2,
    );
    const checkList = takeWithinBudget(
      notPassing.slice(0, CHECKS_LISTED),
      WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS / 2,
    );
    return assertResultWithinLimit("get-factory-pull-request", {
      ok: true as const,
      repo: `${repository.owner}/${repository.repo}`,
      number: summary.number,
      url: summary.htmlUrl,
      title: summary.title.slice(0, 300),
      state: summary.merged ? ("merged" as const) : summary.state,
      draft: summary.draft,
      merged: summary.merged,
      mergedAt: summary.mergedAt,
      mergeCommitSha: summary.mergeCommitSha ?? null,
      headSha: summary.headSha,
      headRef: summary.headRef,
      baseRef: summary.baseRef,
      author: {
        login: summary.userLogin,
        kind: evidence.authorKind,
        builderAuthored: evidence.authorKind === "builder",
      },
      mergeable: summary.mergeable,
      mergeableState: summary.mergeableState,
      additions: summary.additions,
      deletions: summary.deletions,
      changedFiles: summary.changedFiles,
      checks: {
        coverage: evidence.checksCoverage,
        total: evidence.checks.length,
        ...counts,
        allPassing:
          evidence.checksCoverage === "complete" &&
          evidence.checks.length > 0 &&
          counts.passed === evidence.checks.length,
        notPassing: checkList.kept,
        notPassingTruncated:
          checkList.truncated || notPassing.length > CHECKS_LISTED,
      },
      reviewThreads: {
        complete: !evidence.threadsTruncated,
        total: evidence.threads.length,
        unresolved: unresolved.length,
        unresolvedThreads: threadList.kept,
        unresolvedThreadsTruncated:
          threadList.truncated || unresolved.length > THREADS_LISTED,
      },
      reviews: {
        complete: !evidence.reviewsTruncated,
        total: evidence.reviews.length,
      },
    });
  },
});
