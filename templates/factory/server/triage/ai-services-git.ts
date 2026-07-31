import type { AiServicesPullRequestSnapshot } from "./github-ingestion.js";
import type { ReviewCommentObservation } from "./pr-babysit.js";
import type {
  PullRequestCheckObservation,
  PullRequestReviewObservation,
} from "./pr-monitor.js";

export interface AiServicesGitReadClientOptions {
  baseUrl: string;
  authorization: string;
  fetchImpl?: typeof fetch;
}

export interface AiServicesPullRequestLookup {
  projectId: string;
  repo: string;
  pullRequestNumber: number;
}

type JsonResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export function createAiServicesGitReadClient(
  options: AiServicesGitReadClientOptions,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function get<T>(path: string, lookup: AiServicesPullRequestLookup) {
    const url = new URL(path, `${baseUrl}/`);
    url.searchParams.set("projectId", lookup.projectId);
    url.searchParams.set("prNumber", String(lookup.pullRequestNumber));
    const response = (await fetchImpl(url, {
      headers: { Authorization: options.authorization },
    })) as JsonResponse;
    if (!response.ok) {
      throw new Error(
        `ai-services GitHub read failed for ${path}: HTTP ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    async fetchPullRequest(
      lookup: AiServicesPullRequestLookup,
    ): Promise<AiServicesPullRequestSnapshot> {
      const [detail, reviews, checks, files] = await Promise.all([
        get<{
          pullRequest: {
            title: string;
            body: string;
            head: { sha: string };
            htmlUrl: string;
            changedFiles: number;
            additions: number;
            deletions: number;
          };
        }>("/projects/git/fetch-pull-request-detail", lookup),
        get<{
          reviews: Array<{
            user: { login: string };
            state: string;
            submittedAt: string;
          }>;
        }>("/projects/git/fetch-pull-request-reviews", lookup),
        get<{
          checks: Array<{
            name: string;
            status: string;
            conclusion?: string;
            startedAt?: string;
            completedAt?: string;
          }>;
        }>("/projects/git/fetch-pull-request-checks", lookup),
        get<{
          files: Array<{
            filename: string;
            additions: number;
            deletions: number;
          }>;
        }>("/projects/git/fetch-pull-request-files", lookup),
      ]);
      const observedAt = new Date().toISOString();
      const pullRequest = detail.pullRequest;
      const reviewObservations: PullRequestReviewObservation[] =
        reviews.reviews.map((review) => ({
          author: review.user.login,
          state: normalizeReviewState(review.state),
          observedAt: review.submittedAt || observedAt,
        }));
      const checkObservations: PullRequestCheckObservation[] =
        checks.checks.map((check) => ({
          name: check.name,
          state: normalizeCheckState(check.status, check.conclusion),
          observedAt: check.completedAt || check.startedAt || observedAt,
        }));

      return {
        repo: lookup.repo,
        pullRequestNumber: lookup.pullRequestNumber,
        headSha: pullRequest.head.sha,
        title: pullRequest.title,
        sourceUrl: pullRequest.htmlUrl,
        summary: pullRequest.body.slice(0, 4_000),
        changedFiles: files.files.map((file) => file.filename),
        diffLines: files.files.reduce(
          (total, file) => total + file.additions + file.deletions,
          0,
        ),
        coverage: "complete",
        reviews: reviewObservations,
        checks: checkObservations,
        observedAt,
      };
    },

    async fetchPullRequestComments(
      lookup: AiServicesPullRequestLookup,
    ): Promise<{
      comments: ReviewCommentObservation[];
      truncated: boolean;
    }> {
      const result = await get<{
        comments: Array<{
          id: number;
          user: { login: string };
          inReplyToId: number | null;
          body: string;
          path?: string;
          line?: number;
          createdAt: string;
        }>;
        truncated?: boolean;
      }>("/projects/git/fetch-pull-request-review-comments", lookup);

      return {
        comments: result.comments.map((c) => ({
          id: String(c.id),
          author: c.user.login,
          inReplyToId: c.inReplyToId === null ? null : String(c.inReplyToId),
          body: c.body,
          path: c.path,
          line: c.line,
          createdAt: c.createdAt,
        })),
        truncated: result.truncated === true,
      };
    },
  };
}

function normalizeReviewState(
  state: string,
): PullRequestReviewObservation["state"] {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "PENDING":
      return "pending";
    default:
      return "commented";
  }
}

function normalizeCheckState(
  status: string,
  conclusion?: string,
): PullRequestCheckObservation["state"] {
  if (status !== "completed") {
    return status === "in_progress" ? "in_progress" : "queued";
  }
  switch (conclusion) {
    case "success":
      return "passed";
    case "cancelled":
    case "timed_out":
      return "cancelled";
    default:
      return "failed";
  }
}
