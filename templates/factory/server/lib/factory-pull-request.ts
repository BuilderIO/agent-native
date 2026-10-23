import type { TriageCoverage } from "../triage/contracts.js";
import {
  GitHubRequestError,
  type GitHubPullRequestSummary,
  type createGitHubClient,
} from "../triage/github-client.js";
import type { ReviewCommentObservation } from "../triage/pr-babysit.js";
import type {
  PullRequestCheckObservation,
  PullRequestReviewObservation,
} from "../triage/pr-monitor.js";
import {
  parseGitHubRepositoryRef,
  type GitHubRepositoryRef,
} from "./github-repository.js";
import {
  failWorkflowAction,
  isWorkflowActionError,
} from "./workflow-action-errors.js";

export type GitHubClient = ReturnType<typeof createGitHubClient>;

/**
 * The logins whose pull requests the merge gate treats as Builder's, each
 * matched whole and ignoring case, `[bot]` suffix included. Deliberately not
 * `DEFAULT_BABYSIT_BOT_AUTHORS`: that list also sorts review bots, and its other
 * Builder-looking names (`builder-io-bot`, `builderio-bot[bot]`) must not let a
 * pull request merge without a person.
 */
export const BUILDER_MERGE_AUTHOR_LOGINS: readonly string[] = [
  "builderio-bot",
  "builder-io-integration[bot]",
];

/**
 * GitHub's numeric ids of those accounts, to be filled in once the owner has
 * confirmed each one is Builder's. A login alone is not proof: a plain name
 * nobody has registered can be claimed by anyone, who can then open a pull
 * request as it from a fork. While this is empty the author is judged by login
 * only; once it holds ids, a pull request whose author id is not listed is not
 * Builder's, whatever its login says.
 */
const BUILDER_PULL_REQUEST_AUTHOR_IDS: readonly number[] = [];

export type PullRequestAuthorKind = "builder" | "bot" | "human";

export function isBuilderLogin(login: string): boolean {
  const lowered = login.toLowerCase();
  return BUILDER_MERGE_AUTHOR_LOGINS.some((allowed) => allowed === lowered);
}

export function classifyPullRequestAuthor(
  login: string,
  userId: number,
  allowedIds: readonly number[] = BUILDER_PULL_REQUEST_AUTHOR_IDS,
): PullRequestAuthorKind {
  if (
    isBuilderLogin(login) &&
    (allowedIds.length === 0 || allowedIds.includes(userId))
  )
    return "builder";
  return login.trim().toLowerCase().endsWith("[bot]") ? "bot" : "human";
}

interface ReviewThreadSummary {
  threadId: string;
  resolved: boolean;
  outdated: boolean;
  path: string | null;
  line: number | null;
  author: string;
  preview: string;
  comments: number;
}

interface PullRequestEvidence {
  summary: GitHubPullRequestSummary;
  authorKind: PullRequestAuthorKind;
  checks: PullRequestCheckObservation[];
  checksCoverage: TriageCoverage;
  reviews: PullRequestReviewObservation[];
  reviewsTruncated: boolean;
  comments: ReviewCommentObservation[];
  threads: ReviewThreadSummary[];
  threadsTruncated: boolean;
}

export function parseRepositoryInput(repo: string): GitHubRepositoryRef {
  try {
    return parseGitHubRepositoryRef(repo);
  } catch {
    return failWorkflowAction({
      message: "The repository must be owner/name or a GitHub URL.",
      errorCode: "github_repository_invalid",
      statusCode: 400,
    });
  }
}

/**
 * A GitHub failure as a typed one. The message carries the status, never the
 * response body.
 */
export function failGitHubStep(error: unknown, what: string): never {
  if (error instanceof GitHubRequestError) {
    if (!error.requestAttempted) {
      return failWorkflowAction({
        message:
          "GitHub is not connected for this workspace. Connect GitHub in Dispatch or add a token to the vault.",
        errorCode: "github_not_connected",
        statusCode: 412,
      });
    }
    if (error.rateLimited) {
      return failWorkflowAction({
        message: `GitHub is rate limiting this workspace while ${what}.`,
        errorCode: "github_rate_limited",
        statusCode: 429,
        retryable: true,
      });
    }
    const status = error.status;
    if (status === 404) {
      return failWorkflowAction({
        message: `GitHub could not find the pull request while ${what}. Check the repository and number, and that the token can see the repository.`,
        errorCode: "github_not_found",
        statusCode: 404,
        details: { status },
      });
    }
    if (status === 401 || status === 403) {
      return failWorkflowAction({
        message: `GitHub refused the connected credential while ${what} (HTTP ${status}).`,
        errorCode: "github_access_denied",
        statusCode: 403,
        details: { status },
      });
    }
    return failWorkflowAction({
      message: `GitHub failed while ${what}${status ? ` (HTTP ${status})` : ""}.`,
      errorCode: "github_request_failed",
      statusCode: 424,
      retryable: status === null || status >= 500,
      details: status ? { status } : {},
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not configured|configuration is incomplete/i.test(message)) {
    return failWorkflowAction({
      message:
        "GitHub is not connected for this workspace. Connect GitHub in Dispatch or add a token to the vault.",
      errorCode: "github_not_connected",
      statusCode: 412,
    });
  }
  if (/was truncated; cannot treat/i.test(message)) {
    return failWorkflowAction({
      message: `GitHub has more than Factory reads in one page while ${what}, so the evidence is incomplete.`,
      errorCode: "github_evidence_incomplete",
      statusCode: 409,
    });
  }
  return failWorkflowAction({
    message: `GitHub answered in a shape Factory could not read while ${what}.`,
    errorCode: "github_response_invalid",
    statusCode: 424,
  });
}

function groupThreads(
  comments: readonly ReviewCommentObservation[],
): ReviewThreadSummary[] {
  const threads = new Map<string, ReviewThreadSummary>();
  for (const comment of comments) {
    if (!comment.threadId || typeof comment.isResolved !== "boolean") {
      return failWorkflowAction({
        message:
          "GitHub returned review comments without their thread state, so unresolved threads cannot be counted.",
        errorCode: "github_review_threads_unreadable",
        statusCode: 424,
      });
    }
    const existing = threads.get(comment.threadId);
    if (existing) {
      existing.comments += 1;
      continue;
    }
    threads.set(comment.threadId, {
      threadId: comment.threadId,
      resolved: comment.isResolved,
      outdated: comment.isOutdated === true,
      path: comment.path ?? null,
      line: comment.line ?? null,
      author: comment.author,
      preview: comment.body.replace(/\s+/g, " ").trim().slice(0, 200),
      comments: 1,
    });
  }
  return [...threads.values()];
}

/**
 * Everything a workflow needs to judge a pull request, read fresh. Review
 * threads come from GraphQL only: the client's REST fallback cannot say which
 * threads are resolved, so a failed thread read is an error here, never an
 * empty list.
 */
export async function readPullRequestEvidence(
  github: GitHubClient,
  repository: GitHubRepositoryRef,
  number: number,
  /** Gets the failure as GitHub raised it, before it becomes a typed one. Observe only. */
  onFailure?: (error: unknown) => void,
  /** The author ids that count as Builder's; defaults to `BUILDER_PULL_REQUEST_AUTHOR_IDS`. */
  builderAuthorIds?: readonly number[],
): Promise<PullRequestEvidence> {
  try {
    const summary = await github.getPullRequestSummary(repository, number);
    const [reviewPage, threadPage, checkPage] = await Promise.all([
      github.listPullRequestReviews(repository, number),
      github.listPullRequestReviewThreads(repository, number),
      github.getPullRequestChecks(repository, summary.headSha),
    ]);
    if (!threadPage) {
      return failWorkflowAction({
        message:
          "GitHub's review thread data could not be read, so unresolved threads cannot be counted.",
        errorCode: "github_review_threads_unreadable",
        statusCode: 424,
        retryable: true,
      });
    }
    return {
      summary,
      authorKind: classifyPullRequestAuthor(
        summary.userLogin,
        summary.userId,
        builderAuthorIds,
      ),
      checks: checkPage.checks,
      checksCoverage: checkPage.checksCoverage,
      reviews: reviewPage.reviews,
      reviewsTruncated: reviewPage.reviewsTruncated,
      comments: threadPage.comments,
      threads: groupThreads(threadPage.comments),
      threadsTruncated: threadPage.commentsTruncated,
    };
  } catch (error) {
    onFailure?.(error);
    if (isWorkflowActionError(error)) throw error;
    return failGitHubStep(error, "reading the pull request");
  }
}
