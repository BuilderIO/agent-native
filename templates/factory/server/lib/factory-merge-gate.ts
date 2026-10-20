import {
  GitHubRequestError,
  type GitHubPullRequestSummary,
} from "../triage/github-client.js";
import {
  hasCompletePassingChecks,
  hasMergeConflict,
  mergeabilityComputed,
} from "../triage/pr-babysit.js";
import {
  detectOwnerOwnedArea,
  hasActiveCredibleSafetyFinding,
  hasCurrentBlockingPullRequestReview,
  isUltraScaryChange,
} from "../triage/pr-policy.js";
import { describeShape, errorDetails } from "../tripwire/redact.js";
import type { TripwireSink } from "../tripwire/types.js";
import {
  approvalRequiredMessage,
  countApprovals,
  type ApprovalCounts,
} from "./factory-merge-approval.js";
import {
  isBuilderLogin,
  readPullRequestEvidence,
  failGitHubStep,
  type GitHubClient,
  type PullRequestAuthorKind,
} from "./factory-pull-request.js";
import {
  gitHubRepositoriesEqual,
  type GitHubRepositoryRef,
} from "./github-repository.js";
import { isWorkflowActionError } from "./workflow-action-errors.js";

export const MERGE_GATE_LIMITS = {
  maxChangedFiles: 30,
  maxDiffLines: 1_500,
} as const;

/** Source of the publishable packages: a change there ships to npm. */
const PUBLISHABLE_PACKAGE_PATH =
  /^packages\/(?:core|dispatch|scheduling|pinpoint)\//;

export type MergeGateCode =
  | "repository_not_allowed"
  | "already_merged"
  | "pull_request_closed"
  | "pull_request_draft"
  | "author_not_builder"
  | "author_id_mismatch"
  | "pull_request_from_fork"
  | "base_not_default_branch"
  | "merge_conflict"
  | "mergeability_pending"
  | "checks_not_green"
  | "reviews_blocking"
  | "reviews_incomplete"
  | "approval_required"
  | "review_threads_unresolved"
  | "review_threads_incomplete"
  | "safety_finding"
  | "diff_too_large"
  | "changed_files_unreadable"
  | "security"
  | "publishable_package"
  | "owner_owned";

interface MergeGateReason {
  code: MergeGateCode;
  message: string;
  /** Only on `approval_required`: what the rule counted. */
  counts?: ApprovalCounts;
}

interface MergeGateResult {
  eligible: boolean;
  reasons: MergeGateReason[];
  /**
   * The approvals the reviews held. Counted over the reviews read, so partial
   * when `reviews_incomplete` is among the reasons. Null only when the
   * repository is refused before anything is read.
   */
  approvals: ApprovalCounts | null;
  /** Null only when the repository is refused before anything is read. */
  pullRequest: {
    number: number;
    url: string;
    state: string;
    draft: boolean;
    merged: boolean;
    mergeCommitSha: string | null;
    headSha: string;
    authorLogin: string;
    authorKind: PullRequestAuthorKind;
  } | null;
}

/** The catalog operation a merge runs as; the id its tripwire events carry. */
export const MERGE_OPERATION_ID = "github.mergePullRequest";

/** A branch pushed to any repository but the one it merges into, or to one GitHub no longer has. */
function isFromFork(
  summary: Pick<GitHubPullRequestSummary, "headRepository" | "baseRepository">,
): boolean {
  return (
    summary.headRepository === null ||
    summary.headRepository.toLowerCase() !==
      summary.baseRepository.toLowerCase()
  );
}

/** Counts and words only: what the gate saw, so a merge that was or was not allowed can be read back. */
function gateSnapshot(
  evidence: Awaited<ReturnType<typeof readPullRequestEvidence>>,
  approvals: ApprovalCounts,
  reasons: readonly MergeGateReason[],
) {
  const { summary, checks, threads } = evidence;
  const count = (states: readonly string[]) =>
    checks.filter((check) => states.includes(check.state)).length;
  return {
    checksTotal: checks.length,
    checksPassing: count(["passed"]),
    checksFailing: count(["failed"]),
    checksPending: count(["queued", "in_progress"]),
    checksCoverage: evidence.checksCoverage,
    threadsTotal: threads.length,
    threadsUnresolved: threads.filter((thread) => !thread.resolved).length,
    threadsOutdated: threads.filter((thread) => thread.outdated).length,
    threadsTruncated: evidence.threadsTruncated,
    approvalsSeen: approvals.seen,
    approvalsQualifying: approvals.qualifying,
    approvalsByAuthor: approvals.byAuthor,
    approvalsFromBots: approvals.fromBots,
    approvalsFromNonCollaborators: approvals.fromNonCollaborators,
    approvalsStale: approvals.stale,
    headSha: summary.headSha.slice(0, 7),
    authorKind: evidence.authorKind,
    baseBranch: summary.baseRef,
    baseIsDefault: summary.baseRef === summary.baseDefaultBranch,
    fromFork: isFromFork(summary),
    eligible: reasons.length === 0,
    clauses: reasons.map((reason) => reason.code).join(","),
  };
}

/**
 * The client keeps a refusal's body only inside the error's message, clipped to
 * 500 characters, so a longer JSON body reads back as text.
 */
function errorBodyOf(error: GitHubRequestError): unknown {
  const body = /\bHTTP \d{3} - ([\s\S]+)$/.exec(error.message)?.[1];
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    // coercion-ok: a body that is not JSON is reported as text, whose shape is "string"
    return body;
  }
}

/** What a failed GitHub call says about itself: the status and the structure of its body, never the text. */
export function githubFailureDetails(error: unknown): Record<string, unknown> {
  if (error instanceof GitHubRequestError && error.status !== null) {
    return {
      status: error.status,
      bodyShape: describeShape(errorBodyOf(error)),
      ...(error.rateLimited ? { rateLimited: true } : {}),
    };
  }
  return errorDetails(error);
}

export function reportMergeUnexpected(
  tripwire: TripwireSink | undefined,
  details: Record<string, unknown>,
): void {
  tripwire?.({
    area: "merge",
    code: "merge_unexpected_response",
    severity: "error",
    operationId: MERGE_OPERATION_ID,
    details,
  });
}

function listNames(names: readonly string[], limit = 5): string {
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit
    ? `${shown} and ${names.length - limit} more`
    : shown;
}

/**
 * Whether a pull request may merge without a person. Every rule runs and every
 * failing one is reported, so the notice a person gets names all of them. The
 * governance rules are the review-prs ones in `pr-policy`: the never-automate
 * paths (auth, sessions, identity, credentials, vault, migrations, payments,
 * security), owner-owned areas, and a fresh credible safety finding. A read
 * that fails is thrown, not turned into "ineligible": a person should be told
 * why a pull request is not mergeable, not that GitHub was down.
 */
export async function evaluateMergeGate(input: {
  github: GitHubClient;
  repository: GitHubRepositoryRef;
  repositoryLabel: string;
  number: number;
  /** The repository this factory may act on; null when none is configured. */
  configuredRepository: string | null;
  /** GitHub ids that count as Builder's accounts; defaults to the verified list in `factory-pull-request`. */
  builderAuthorIds?: readonly number[];
  /**
   * When given, the evidence the gate judged is recorded as one snapshot, or a
   * read that failed as `gate_read_failed`: a merge passes it, a read-only
   * check does not.
   */
  tripwire?: TripwireSink;
}): Promise<MergeGateResult> {
  const { github, repository, number } = input;
  const reasons: MergeGateReason[] = [];
  const add = (code: MergeGateCode, message: string, counts?: ApprovalCounts) =>
    reasons.push(counts ? { code, message, counts } : { code, message });

  if (
    !gitHubRepositoriesEqual(input.configuredRepository, input.repositoryLabel)
  ) {
    add(
      "repository_not_allowed",
      input.configuredRepository
        ? `${input.repositoryLabel} is not this factory's repository (${input.configuredRepository}).`
        : "This factory has no repository configured, so it may not merge in any.",
    );
    return { eligible: false, reasons, approvals: null, pullRequest: null };
  }

  const reportReadFailed = (read: string) => (error: unknown) =>
    reportMergeUnexpected(input.tripwire, {
      reason: "gate_read_failed",
      read,
      ...githubFailureDetails(error),
    });

  const evidence = await readPullRequestEvidence(
    github,
    repository,
    number,
    reportReadFailed("pull_request_evidence"),
    input.builderAuthorIds,
  );
  const { summary } = evidence;
  const state = summary.merged ? "merged" : summary.state;
  const approvals = countApprovals(evidence.reviews, {
    headSha: summary.headSha,
    authorLogin: summary.userLogin,
  });

  if (summary.merged)
    add("already_merged", "The pull request is already merged.");
  else if (summary.state !== "open")
    add("pull_request_closed", "The pull request is closed without a merge.");
  if (summary.state === "open" && summary.draft)
    add("pull_request_draft", "The pull request is still a draft.");

  if (evidence.authorKind !== "builder") {
    if (isBuilderLogin(summary.userLogin)) {
      add(
        "author_id_mismatch",
        `The pull request's author is named ${summary.userLogin}, but GitHub user ${summary.userId} is not a verified Builder account.`,
      );
    } else {
      add(
        "author_not_builder",
        `The pull request was opened by ${summary.userLogin}, not by a Builder account.`,
      );
    }
  }

  if (isFromFork(summary)) {
    add(
      "pull_request_from_fork",
      summary.headRepository === null
        ? "The pull request's branch is in a repository GitHub no longer has, so it cannot be told apart from a fork."
        : `The pull request's branch is in ${summary.headRepository}, not in ${summary.baseRepository}: a fork's code is not merged automatically.`,
    );
  }
  if (summary.baseRef !== summary.baseDefaultBranch) {
    add(
      "base_not_default_branch",
      `The pull request merges into ${summary.baseRef}, not the default branch ${summary.baseDefaultBranch}.`,
    );
  }

  if (!summary.merged && summary.state === "open") {
    if (!mergeabilityComputed(summary)) {
      add(
        "mergeability_pending",
        "GitHub is still working out whether the branch merges cleanly.",
      );
    } else if (hasMergeConflict(summary)) {
      add("merge_conflict", "The branch has a merge conflict.");
    }

    if (!hasCompletePassingChecks(evidence)) {
      const notPassing = evidence.checks.filter(
        (check) => check.state !== "passed",
      );
      add(
        "checks_not_green",
        evidence.checksCoverage !== "complete"
          ? `Check coverage on the head commit is ${evidence.checksCoverage}, so CI cannot be called green.`
          : evidence.checks.length === 0
            ? "No checks have reported on the head commit."
            : `Checks are not all green on the head commit: ${listNames(notPassing.map((check) => `${check.name} (${check.state})`))}.`,
      );
    }

    if (evidence.reviewsTruncated) {
      // The newest reviews are the unread ones, so no approval can be called missing.
      add(
        "reviews_incomplete",
        "The pull request has more reviews than Factory reads.",
      );
    } else {
      if (
        hasCurrentBlockingPullRequestReview(evidence.reviews, summary.headSha)
      )
        add(
          "reviews_blocking",
          "A review that requested changes, or a pending review, is still blocking.",
        );
      if (approvals.qualifying === 0)
        add("approval_required", approvalRequiredMessage(approvals), approvals);
    }

    const unresolved = evidence.threads.filter((thread) => !thread.resolved);
    if (evidence.threadsTruncated) {
      add(
        "review_threads_incomplete",
        "The pull request has more review threads than Factory reads.",
      );
    }
    if (unresolved.length > 0) {
      add(
        "review_threads_unresolved",
        `${unresolved.length} review thread${unresolved.length === 1 ? " is" : "s are"} unresolved.`,
      );
    }
    if (hasActiveCredibleSafetyFinding(evidence.reviews, evidence.comments)) {
      add(
        "safety_finding",
        "A review comment raises a credible safety finding that is not resolved.",
      );
    }

    const diffLines = summary.additions + summary.deletions;
    if (
      summary.changedFiles > MERGE_GATE_LIMITS.maxChangedFiles ||
      diffLines > MERGE_GATE_LIMITS.maxDiffLines
    ) {
      add(
        "diff_too_large",
        `The pull request changes ${summary.changedFiles} files and ${diffLines} lines; the limits are ${MERGE_GATE_LIMITS.maxChangedFiles} files and ${MERGE_GATE_LIMITS.maxDiffLines} lines.`,
      );
    } else {
      let files: readonly string[];
      try {
        files = await github.listPullRequestChangedFiles(repository, number);
      } catch (error) {
        reportReadFailed("changed_files")(error);
        if (isWorkflowActionError(error)) throw error;
        return failGitHubStep(error, "reading the changed files");
      }
      if (files.length === 0 || files.length !== summary.changedFiles) {
        add(
          "changed_files_unreadable",
          `GitHub reports ${summary.changedFiles} changed files but listed ${files.length}, so the diff cannot be checked.`,
        );
      } else {
        const scary = files.filter((file) => isUltraScaryChange([file]));
        if (scary.length > 0) {
          add(
            "security",
            `Security-sensitive or never-automate paths changed (auth, sessions, identity, credentials, vault, migrations, payments, security, deploy, tooling): ${listNames(scary)}.`,
          );
        }
        const publishable = files.filter((file) =>
          PUBLISHABLE_PACKAGE_PATH.test(file),
        );
        if (publishable.length > 0) {
          add(
            "publishable_package",
            `Publishable package source changed: ${listNames(publishable)}.`,
          );
        }
        const area = detectOwnerOwnedArea([
          input.repositoryLabel,
          summary.title,
          summary.body,
          ...files,
        ]);
        if (area) {
          add(
            "owner_owned",
            `${area} is owner-managed and never merged automatically.`,
          );
        }
      }
    }
  }

  input.tripwire?.({
    area: "merge",
    code: "merge_gate_snapshot",
    severity: "info",
    operationId: MERGE_OPERATION_ID,
    details: gateSnapshot(evidence, approvals, reasons),
  });

  return {
    eligible: reasons.length === 0,
    reasons,
    approvals,
    pullRequest: {
      number: summary.number,
      url: summary.htmlUrl,
      state,
      draft: summary.draft,
      merged: summary.merged,
      mergeCommitSha: summary.mergeCommitSha ?? null,
      headSha: summary.headSha,
      authorLogin: summary.userLogin,
      authorKind: evidence.authorKind,
    },
  };
}
