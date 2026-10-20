import {
  GitHubMergeNotCompletedError,
  GitHubRequestError,
  type GitHubMergeMethod,
  type GitHubRepositoryMergeSettings,
} from "../triage/github-client.js";
import type { TripwireSink } from "../tripwire/types.js";
import {
  MERGE_OPERATION_ID,
  evaluateMergeGate,
  githubFailureDetails,
  reportMergeUnexpected,
} from "./factory-merge-gate.js";
import { failGitHubStep, type GitHubClient } from "./factory-pull-request.js";
import type { GitHubRepositoryRef } from "./github-repository.js";
import {
  failWorkflowAction,
  isWorkflowActionError,
} from "./workflow-action-errors.js";

const METHOD_ORDER: readonly GitHubMergeMethod[] = [
  "squash",
  "merge",
  "rebase",
];

interface GatedMergeResult {
  sha: string;
  url: string;
  headSha: string;
  mergeMethod: GitHubMergeMethod | null;
  /** The pull request was already merged, so this call changed nothing. */
  alreadyMerged: boolean;
  /** A failed merge request turned out to have merged; found by reading it back. */
  reconciled: boolean;
}

/** The requested method when the repository allows it, else the first it allows. */
export function chooseMergeMethod(
  requested: GitHubMergeMethod,
  settings: GitHubRepositoryMergeSettings,
): GitHubMergeMethod | null {
  const allowed: Record<GitHubMergeMethod, boolean> = {
    squash: settings.allowSquashMerge,
    merge: settings.allowMergeCommit,
    rebase: settings.allowRebaseMerge,
  };
  if (allowed[requested]) return requested;
  return METHOD_ORDER.find((method) => allowed[method]) ?? null;
}

/**
 * Merges a pull request the merge gate clears, and only that one. The gate
 * runs here, immediately before the merge, whatever a graph ran earlier: a
 * workflow rewired around its gate lookup still cannot merge an ineligible
 * pull request. The merge is pinned to the head commit the gate checked, so a
 * push in between makes GitHub refuse it instead of merging unreviewed code.
 */
export async function mergeGatedPullRequest(input: {
  github: GitHubClient;
  repository: GitHubRepositoryRef;
  repositoryLabel: string;
  number: number;
  mergeMethod: GitHubMergeMethod;
  configuredRepository: string | null;
  /** Where the gate's snapshot and a blocked or unexpected merge are reported; observe only. */
  tripwire?: TripwireSink;
}): Promise<GatedMergeResult> {
  const { github, repository, number } = input;
  const gate = await evaluateMergeGate(input);
  const pullRequest = gate.pullRequest;

  if (pullRequest?.merged) {
    if (!pullRequest.mergeCommitSha) {
      return failWorkflowAction({
        message:
          "The pull request is merged, but GitHub did not report its merge commit.",
        errorCode: "merge_commit_unreadable",
        statusCode: 424,
        // Nothing was merged by this call, and reading the pull request again
        // finds the commit once GitHub has recorded it.
        retryable: true,
      });
    }
    return {
      sha: pullRequest.mergeCommitSha,
      url: pullRequest.url,
      headSha: pullRequest.headSha,
      mergeMethod: null,
      alreadyMerged: true,
      reconciled: false,
    };
  }
  if (!gate.eligible || !pullRequest) {
    reportMergeBlocked(
      input.tripwire,
      gate.reasons.map((reason) => reason.code),
    );
    return failWorkflowAction({
      message: `The merge gate refuses this pull request: ${gate.reasons.map((reason) => reason.message).join(" ")}`,
      errorCode: "merge_gate_ineligible",
      statusCode: 409,
      details: { reasonCodes: gate.reasons.map((reason) => reason.code) },
    });
  }

  let settings: GitHubRepositoryMergeSettings;
  try {
    settings = await github.getRepositoryMergeSettings(repository);
  } catch (error) {
    reportMergeUnexpected(input.tripwire, {
      reason: "settings_read_failed",
      ...githubFailureDetails(error),
    });
    return failGitHubStep(error, "reading the repository's merge settings");
  }
  const mergeMethod = chooseMergeMethod(input.mergeMethod, settings);
  if (!mergeMethod) {
    reportMergeBlocked(input.tripwire, ["merge_method_unavailable"]);
    return failWorkflowAction({
      message: "The repository allows no merge method, so nothing can merge.",
      errorCode: "merge_method_unavailable",
      statusCode: 409,
    });
  }

  try {
    const merged = await github.mergePullRequest(
      repository,
      number,
      undefined,
      pullRequest.headSha,
      mergeMethod,
    );
    return {
      sha: merged.sha,
      url: pullRequest.url,
      headSha: pullRequest.headSha,
      mergeMethod,
      alreadyMerged: false,
      reconciled: false,
    };
  } catch (error) {
    if (isWorkflowActionError(error)) throw error;
    return failMerge(
      error,
      input,
      pullRequest.headSha,
      pullRequest.url,
      mergeMethod,
    );
  }
}

function reportMergeBlocked(
  tripwire: TripwireSink | undefined,
  clauses: readonly string[],
): void {
  tripwire?.({
    area: "merge",
    code: "merge_blocked",
    severity: "warn",
    operationId: MERGE_OPERATION_ID,
    details: { clauses: clauses.join(","), count: clauses.length },
  });
}

/** No status means the request failed before GitHub's answer was read: a dropped connection, a timeout, or an unreadable body. */
function unexpectedReason(error: unknown): string {
  if (!(error instanceof GitHubRequestError)) return "response_unreadable";
  return error.status === null ? "no_http_status" : "non_2xx";
}

async function failMerge(
  error: unknown,
  input: {
    github: GitHubClient;
    repository: GitHubRepositoryRef;
    number: number;
    tripwire?: TripwireSink;
  },
  headSha: string,
  url: string,
  mergeMethod: GitHubMergeMethod,
): Promise<GatedMergeResult> {
  if (error instanceof GitHubMergeNotCompletedError) {
    reportMergeUnexpected(input.tripwire, {
      reason: "merged_flag_not_true",
      httpOk: true,
    });
    return failWorkflowAction({
      message: "GitHub answered that the pull request was not merged.",
      errorCode: "merge_rejected",
      statusCode: 409,
    });
  }
  if (error instanceof GitHubRequestError && !error.requestAttempted) {
    return failGitHubStep(error, "merging the pull request");
  }
  if (error instanceof GitHubRequestError) {
    const status = error.status;
    if (status === 409) {
      reportMergeBlocked(input.tripwire, ["merge_head_changed"]);
      return failWorkflowAction({
        message:
          "The branch changed after the merge gate checked it, so GitHub refused to merge the new commit unreviewed. Run the gate again.",
        errorCode: "merge_head_changed",
        statusCode: 409,
      });
    }
    if (status === 405 || status === 422) {
      reportMergeBlocked(input.tripwire, ["merge_not_allowed"]);
      return failWorkflowAction({
        message: `GitHub refused the merge (HTTP ${status}): branch protection, a required check, or a conflict is blocking it.`,
        errorCode: "merge_not_allowed",
        statusCode: 409,
        details: { status },
      });
    }
  }

  reportMergeUnexpected(input.tripwire, {
    reason: unexpectedReason(error),
    ...githubFailureDetails(error),
  });
  if (
    error instanceof GitHubRequestError &&
    (error.rateLimited || (error.status !== null && error.status < 500))
  ) {
    return failGitHubStep(error, "merging the pull request");
  }

  // The request may have reached GitHub: a 5xx or a dropped connection says
  // nothing about whether the merge happened, so read it back.
  try {
    const live = await input.github.getPullRequestSummary(
      input.repository,
      input.number,
    );
    if (live.merged && live.mergeCommitSha) {
      return {
        sha: live.mergeCommitSha,
        url,
        headSha,
        mergeMethod,
        alreadyMerged: false,
        reconciled: true,
      };
    }
  } catch {
    // coercion-ok: a failed read-back leaves the outcome unknown, which is reported below, never as success.
  }
  return failWorkflowAction({
    message: "GitHub did not confirm whether the pull request was merged.",
    errorCode: "merge_outcome_unknown",
    statusCode: 424,
    details: { headSha },
  });
}
