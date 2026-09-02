import { resolveConnectorSecret } from "../connectors/credentials.js";
import type { TriageCoverage } from "./contracts.js";
import type { ReviewCommentObservation } from "./pr-babysit.js";
import type {
  PullRequestCheckObservation,
  PullRequestReviewObservation,
} from "./pr-monitor.js";

const DEFAULT_BASE_URL = "https://api.github.com";
const MAX_PAGE_SIZE = 100;

type FetchLike = typeof fetch;

export interface GitHubClientIdentity {
  ownerEmail: string;
  orgId?: string | null;
}

export interface GitHubClientOptions extends GitHubClientIdentity {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  htmlUrl: string;
  userId: number;
  userLogin: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
  userLogin: string;
  userId: string;
  labels: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface GitHubPullRequestSummary extends GitHubPullRequest {
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: boolean | null;
  mergeableState: string | null;
  reviewComments: number;
}

export interface GitHubMemberCheck {
  username: string;
  isMember: boolean;
  permission: "admin" | "maintain" | "push" | "triage" | "pull" | null;
}

export interface GitHubApproval {
  id: number;
  state: "APPROVED";
  htmlUrl: string;
}

export interface GitHubMergeResult {
  sha: string;
  merged: true;
  message: string;
}

export interface GitHubComment {
  id: number;
  htmlUrl: string;
}

export class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly requestAttempted: boolean,
    readonly status: number | null = null,
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

function isChecksPermissionDenied(error: unknown): boolean {
  return (
    error instanceof GitHubRequestError &&
    error.status === 403 &&
    !error.rateLimited &&
    /resource not accessible by personal access token/i.test(error.message)
  );
}

export interface GitHubIssueCreateResult {
  number: number;
  htmlUrl: string;
}

export interface GitHubPullRequestEvidence {
  comments: readonly ReviewCommentObservation[];
  commentsTruncated: boolean;
  reviews: readonly PullRequestReviewObservation[];
  checks: readonly PullRequestCheckObservation[];
  checksCoverage: TriageCoverage;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GitHub response is missing ${field}`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`GitHub response is missing ${field}`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`GitHub response is missing ${field}`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub response was not an object");
  }
  return value as Record<string, unknown>;
}

function pageSize(limit?: number): number {
  if (limit === undefined) return MAX_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error(
      `GitHub limit must be an integer from 1 to ${MAX_PAGE_SIZE}`,
    );
  }
  return limit;
}

function repositoryPath(repository: GitHubRepositoryRef): string {
  const owner = repository.owner.trim();
  const repo = repository.repo.trim();
  if (!owner || !repo) throw new Error("GitHub owner and repo are required");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function parsePullRequest(value: unknown): GitHubPullRequest {
  const item = record(value);
  const user = record(item.user);
  const head = record(item.head);
  const base = record(item.base);
  return {
    number: requiredNumber(item.number, "pull request number"),
    title: requiredString(item.title, "pull request title"),
    body:
      item.body === null
        ? null
        : requiredString(item.body, "pull request body"),
    state: requiredString(item.state, "pull request state"),
    draft: requiredBoolean(item.draft, "pull request draft state"),
    htmlUrl: requiredString(item.html_url, "pull request URL"),
    userId: requiredNumber(user.id, "pull request author ID"),
    userLogin: requiredString(user.login, "pull request author"),
    headSha: requiredString(head.sha, "pull request head SHA"),
    headRef: requiredString(head.ref, "pull request head branch"),
    baseRef: requiredString(base.ref, "pull request base ref"),
    createdAt: requiredString(item.created_at, "pull request created time"),
    updatedAt: requiredString(item.updated_at, "pull request updated time"),
  };
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub ${field} response was not an array`);
  }
  return value;
}

function loginFromUser(value: unknown, field: string): string {
  if (value === null) {
    throw new Error(`GitHub ${field} has no user`);
  }
  return requiredString(record(value).login, `${field} user login`);
}

function requirePositivePullRequestNumber(pullRequestNumber: number): void {
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("GitHub pull request number must be a positive integer");
  }
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
    case "DISMISSED":
      return "dismissed";
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

function parseReviewComment(value: unknown): ReviewCommentObservation {
  const item = record(value);
  const inReplyToId = item.in_reply_to_id;
  const line = item.line ?? item.original_line;
  return {
    id: String(requiredNumber(item.id, "review comment id")),
    author: loginFromUser(item.user, "review comment"),
    inReplyToId:
      inReplyToId == null
        ? null
        : String(requiredNumber(inReplyToId, "in_reply_to_id")),
    body:
      typeof item.body === "string"
        ? item.body
        : requiredString(item.body, "review comment body"),
    path:
      typeof item.path === "string" && item.path.length > 0
        ? item.path
        : undefined,
    line: typeof line === "number" && Number.isFinite(line) ? line : undefined,
    createdAt: requiredString(item.created_at, "review comment created time"),
  };
}

function parseReview(
  value: unknown,
  fallbackObservedAt: string,
): PullRequestReviewObservation {
  const item = record(value);
  const submittedAt =
    (typeof item.submitted_at === "string" && item.submitted_at) ||
    fallbackObservedAt;
  return {
    author: loginFromUser(item.user, "review"),
    state: normalizeReviewState(
      requiredString(item.state, "review state").toUpperCase(),
    ),
    ...(typeof item.commit_id === "string" && item.commit_id.trim()
      ? { commitSha: item.commit_id }
      : {}),
    ...(typeof item.html_url === "string" && item.html_url
      ? { htmlUrl: item.html_url }
      : {}),
    ...(typeof item.body === "string" ? { body: item.body } : {}),
    observedAt: submittedAt,
  };
}

function parseCheckRun(value: unknown): PullRequestCheckObservation {
  const item = record(value);
  const status = requiredString(item.status, "check-run status");
  const conclusion =
    item.conclusion === null || item.conclusion === undefined
      ? undefined
      : requiredString(item.conclusion, "check-run conclusion");
  const observedAt =
    (typeof item.completed_at === "string" && item.completed_at) ||
    (typeof item.started_at === "string" && item.started_at);
  if (!observedAt) {
    throw new Error("GitHub check-run response is missing started_at");
  }
  return {
    name: requiredString(item.name, "check-run name"),
    state: normalizeCheckState(status, conclusion),
    observedAt,
  };
}

function parseWorkflowRun(value: unknown): PullRequestCheckObservation {
  const item = record(value);
  const status = requiredString(item.status, "workflow-run status");
  const conclusion =
    item.conclusion === null || item.conclusion === undefined
      ? undefined
      : requiredString(item.conclusion, "workflow-run conclusion");
  const observedAt =
    (typeof item.updated_at === "string" && item.updated_at) ||
    (typeof item.run_started_at === "string" && item.run_started_at) ||
    (typeof item.created_at === "string" && item.created_at);
  if (!observedAt) {
    throw new Error("GitHub workflow-run response is missing created_at");
  }
  return {
    name: requiredString(item.name, "workflow-run name"),
    state: normalizeCheckState(status, conclusion),
    observedAt,
  };
}

function parseIssue(value: unknown): GitHubIssue | null {
  const item = record(value);
  if (item.pull_request !== undefined) return null;
  const user = record(item.user);
  const labels = item.labels;
  if (!Array.isArray(labels))
    throw new Error("GitHub issue response is missing labels");
  return {
    number: requiredNumber(item.number, "issue number"),
    title: requiredString(item.title, "issue title"),
    body: item.body === null ? null : requiredString(item.body, "issue body"),
    state: requiredString(item.state, "issue state"),
    htmlUrl: requiredString(item.html_url, "issue URL"),
    userLogin: requiredString(user.login, "issue author"),
    userId: String(requiredNumber(user.id, "issue author id")),
    labels: labels.map((label) =>
      requiredString(record(label).name, "issue label"),
    ),
    createdAt: requiredString(item.created_at, "issue created time"),
    updatedAt: requiredString(item.updated_at, "issue updated time"),
  };
}

export function createGitHubClient(options: GitHubClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  async function token(): Promise<string> {
    const value = await resolveConnectorSecret(
      "GITHUB_TOKEN",
      options.ownerEmail,
      {
        orgId: options.orgId,
      },
    );
    if (!value)
      throw new Error("GITHUB_TOKEN is not configured for this workspace");
    return value;
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    options: { allowEmpty?: boolean } = {},
  ): Promise<T> {
    let requestAttempted = false;
    try {
      const authorization = `Bearer ${await token()}`;
      requestAttempted = true;
      const response = (await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: authorization,
          "X-GitHub-Api-Version": "2022-11-28",
          ...Object.fromEntries(new Headers(init.headers).entries()),
        },
      })) as JsonResponse;
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        const rateLimited =
          response.status === 429 ||
          (response.status === 403 &&
            /rate limit|secondary rate|abuse detection|retry after/i.test(
              detail,
            ));
        throw new GitHubRequestError(
          `GitHub API request failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`,
          true,
          response.status,
          rateLimited,
        );
      }
      if (response.status === 204 && options.allowEmpty) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GitHubRequestError) throw error;
      throw new GitHubRequestError(
        error instanceof Error ? error.message : "GitHub request failed",
        requestAttempted,
      );
    }
  }

  return {
    async listOpenPullRequests(
      repository: GitHubRepositoryRef,
      limit?: number,
    ) {
      const value = await request<unknown>(
        `${repositoryPath(repository)}/pulls?state=open&per_page=${pageSize(limit)}`,
      );
      if (!Array.isArray(value))
        throw new Error("GitHub pull request response was not an array");
      return value.map(parsePullRequest);
    },

    async listOpenIssues(repository: GitHubRepositoryRef, limit?: number) {
      const value = await request<unknown>(
        `${repositoryPath(repository)}/issues?state=open&per_page=${pageSize(limit)}`,
      );
      if (!Array.isArray(value))
        throw new Error("GitHub issue response was not an array");
      return value.flatMap((item) => {
        const issue = parseIssue(item);
        return issue ? [issue] : [];
      });
    },

    async listPullRequestReviewComments(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
    ) {
      requirePositivePullRequestNumber(pullRequestNumber);
      const comments = requireArray(
        await request<unknown>(
          `${repositoryPath(repository)}/pulls/${pullRequestNumber}/comments?per_page=${pageSize()}`,
        ),
        "review comment",
      ).map(parseReviewComment);
      return {
        comments,
        commentsTruncated: comments.length >= MAX_PAGE_SIZE,
      };
    },

    async getPullRequestEvidence(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
      headSha: string,
    ): Promise<GitHubPullRequestEvidence> {
      requirePositivePullRequestNumber(pullRequestNumber);
      const sha = headSha.trim();
      if (!sha) throw new Error("GitHub pull request head SHA is required");
      const root = repositoryPath(repository);
      const page = pageSize();
      const [reviewPayload, commentPayload] = await Promise.all([
        request<unknown>(
          `${root}/pulls/${pullRequestNumber}/reviews?per_page=${page}`,
        ),
        request<unknown>(
          `${root}/pulls/${pullRequestNumber}/comments?per_page=${page}`,
        ),
      ]);
      const observedAt = new Date().toISOString();
      const comments = requireArray(commentPayload, "review comment").map(
        parseReviewComment,
      );
      const reviews = requireArray(reviewPayload, "review").map((review) =>
        parseReview(review, observedAt),
      );
      let checks: PullRequestCheckObservation[];
      let checksCoverage: TriageCoverage = "complete";
      try {
        const checkBody = record(
          await request<unknown>(
            `${root}/commits/${encodeURIComponent(sha)}/check-runs?per_page=${page}`,
          ),
        );
        const checkRuns = requireArray(checkBody.check_runs, "check-run");
        const totalCount = requiredNumber(
          checkBody.total_count,
          "check-run total_count",
        );
        if (totalCount > checkRuns.length) {
          throw new Error(
            "GitHub check-run page was truncated; cannot treat CI as complete.",
          );
        }
        checks = checkRuns.map(parseCheckRun);
      } catch (error) {
        if (!isChecksPermissionDenied(error)) throw error;

        checksCoverage = "partial";

        // Fine-grained PATs expose Actions read but not Checks in GitHub's
        // permission editor. Use workflow runs for GitHub Actions CI as
        // partial evidence only; required non-Actions checks remain unknown.
        const workflowBody = record(
          await request<unknown>(
            `${root}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=${page}`,
          ),
        );
        const workflowRuns = requireArray(
          workflowBody.workflow_runs,
          "workflow-run",
        );
        const totalCount = requiredNumber(
          workflowBody.total_count,
          "workflow-run total_count",
        );
        if (totalCount > workflowRuns.length) {
          throw new Error(
            "GitHub workflow-run page was truncated; cannot treat CI as complete.",
          );
        }
        checks = workflowRuns.map(parseWorkflowRun);
      }
      return {
        comments,
        commentsTruncated: comments.length >= MAX_PAGE_SIZE,
        reviews,
        checks,
        checksCoverage,
      };
    },

    async listPullRequestChangedFiles(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
    ): Promise<readonly string[]> {
      requirePositivePullRequestNumber(pullRequestNumber);
      const files = requireArray(
        await request<unknown>(
          `${repositoryPath(repository)}/pulls/${pullRequestNumber}/files?per_page=${pageSize()}`,
        ),
        "pull request file",
      );
      if (files.length >= MAX_PAGE_SIZE) {
        throw new Error(
          "GitHub pull-request file page was truncated; cannot treat the diff as complete.",
        );
      }
      return files.map((file) =>
        requiredString(record(file).filename, "pull request filename"),
      );
    },

    async getPullRequestSummary(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
    ) {
      requirePositivePullRequestNumber(pullRequestNumber);
      const item = record(
        await request<unknown>(
          `${repositoryPath(repository)}/pulls/${pullRequestNumber}`,
        ),
      );
      const pullRequest = parsePullRequest(item);
      return {
        ...pullRequest,
        additions: requiredNumber(item.additions, "pull request additions"),
        deletions: requiredNumber(item.deletions, "pull request deletions"),
        changedFiles: requiredNumber(
          item.changed_files,
          "pull request changed files",
        ),
        mergeable:
          item.mergeable === null
            ? null
            : requiredBoolean(item.mergeable, "pull request mergeable state"),
        mergeableState:
          item.mergeable_state === null
            ? null
            : requiredString(
                item.mergeable_state,
                "pull request mergeable state",
              ),
        reviewComments: requiredNumber(
          item.review_comments,
          "pull request review comments",
        ),
      } satisfies GitHubPullRequestSummary;
    },

    async getAuthenticatedUser() {
      const item = record(await request<unknown>("/user"));
      return {
        login: requiredString(item.login, "authenticated GitHub user login"),
        id: requiredNumber(item.id, "authenticated GitHub user id"),
      };
    },

    async checkMember(
      repository: GitHubRepositoryRef,
      username: string,
    ): Promise<GitHubMemberCheck> {
      const member = username.trim();
      if (!member) throw new Error("GitHub member username is required");
      const path = `${repositoryPath(repository)}/collaborators/${encodeURIComponent(member)}/permission`;
      try {
        const item = record(await request<unknown>(path));
        const permission = item.permission;
        if (
          permission !== "admin" &&
          permission !== "maintain" &&
          permission !== "push" &&
          permission !== "triage" &&
          permission !== "pull"
        ) {
          throw new Error("GitHub member response has an invalid permission");
        }
        return { username: member, isMember: true, permission };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("GitHub API request failed: HTTP 404")
        ) {
          return { username: member, isMember: false, permission: null };
        }
        throw error;
      }
    },

    async checkOrganizationMember(
      organization: string,
      username: string,
    ): Promise<GitHubMemberCheck> {
      const org = organization.trim();
      const member = username.trim();
      if (!org || !member) {
        throw new Error("GitHub organization and member username are required");
      }
      try {
        await request<undefined>(
          `/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(member)}`,
          {},
          { allowEmpty: true },
        );
        return { username: member, isMember: true, permission: null };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("GitHub API request failed: HTTP 404")
        ) {
          return { username: member, isMember: false, permission: null };
        }
        throw error;
      }
    },

    async checkOrganizationMemberById(
      organization: string,
      userId: number,
      username: string,
    ): Promise<GitHubMemberCheck> {
      const member = username.trim();
      if (!organization.trim() || !member || !Number.isInteger(userId)) {
        throw new Error(
          "GitHub organization, member username, and user ID are required",
        );
      }
      try {
        const user = record(
          await request<unknown>(`/users/${encodeURIComponent(member)}`),
        );
        const resolvedId = requiredNumber(user.id, "GitHub user ID");
        const resolvedLogin = requiredString(user.login, "GitHub user login");
        if (resolvedId !== userId || resolvedLogin !== member) {
          return { username: member, isMember: false, permission: null };
        }
        await request<undefined>(
          `/orgs/${encodeURIComponent(organization.trim())}/members/${encodeURIComponent(resolvedLogin)}`,
          {},
          { allowEmpty: true },
        );
        return { username: member, isMember: true, permission: null };
      } catch (error) {
        if (error instanceof GitHubRequestError && error.status === 404) {
          return { username: member, isMember: false, permission: null };
        }
        throw error;
      }
    },

    async approvePullRequest(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
      body?: string,
      commitSha?: string,
    ): Promise<GitHubApproval> {
      if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1)
        throw new Error(
          "GitHub pull request number must be a positive integer",
        );
      const item = record(
        await request<unknown>(
          `${repositoryPath(repository)}/pulls/${pullRequestNumber}/reviews`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "APPROVE",
              ...(body ? { body: body.slice(0, 4_000) } : {}),
              ...(commitSha ? { commit_id: commitSha } : {}),
            }),
          },
        ),
      );
      return {
        id: requiredNumber(item.id, "approval id"),
        state: "APPROVED",
        htmlUrl: requiredString(item.html_url, "approval URL"),
      };
    },

    async createIssue(
      repository: GitHubRepositoryRef,
      input: { title: string; body: string },
    ): Promise<GitHubIssueCreateResult> {
      const title = input.title.trim();
      const body = input.body.trim();
      if (!title) throw new Error("GitHub issue title is required");
      if (!body) throw new Error("GitHub issue body is required");
      const item = record(
        await request<unknown>(`${repositoryPath(repository)}/issues`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.slice(0, 256),
            body: body.slice(0, 65_536),
          }),
        }),
      );
      return {
        number: requiredNumber(item.number, "issue number"),
        htmlUrl: requiredString(item.html_url, "issue URL"),
      };
    },

    async addIssueReaction(
      repository: GitHubRepositoryRef,
      issueNumber: number,
      content: string,
    ): Promise<{ added: boolean; already_present: boolean }> {
      if (!Number.isInteger(issueNumber) || issueNumber < 1) {
        throw new Error("GitHub issue number must be a positive integer");
      }
      try {
        await request<unknown>(
          `${repositoryPath(repository)}/issues/${issueNumber}/reactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          },
        );
        return { added: true, already_present: false };
      } catch (error) {
        if (!String(error).includes("HTTP 422")) throw error;
        return { added: false, already_present: true };
      }
    },

    async createIssueComment(
      repository: GitHubRepositoryRef,
      issueNumber: number,
      body: string,
    ): Promise<GitHubComment> {
      if (!Number.isInteger(issueNumber) || issueNumber < 1) {
        throw new Error("GitHub issue number must be a positive integer");
      }
      const trimmedBody = body.trim();
      if (!trimmedBody) throw new Error("GitHub comment body is required");
      const item = record(
        await request<unknown>(
          `${repositoryPath(repository)}/issues/${issueNumber}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: trimmedBody.slice(0, 65_536) }),
          },
        ),
      );
      return {
        id: requiredNumber(item.id, "comment id"),
        htmlUrl: requiredString(item.html_url, "comment URL"),
      };
    },

    async mergePullRequest(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
      commitMessage?: string,
      expectedHeadSha?: string,
    ): Promise<GitHubMergeResult> {
      if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1)
        throw new Error(
          "GitHub pull request number must be a positive integer",
        );
      const item = record(
        await request<unknown>(
          `${repositoryPath(repository)}/pulls/${pullRequestNumber}/merge`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              commitMessage
                ? {
                    commit_message: commitMessage.slice(0, 4_000),
                    ...(expectedHeadSha ? { sha: expectedHeadSha } : {}),
                  }
                : expectedHeadSha
                  ? { sha: expectedHeadSha }
                  : {},
            ),
          },
        ),
      );
      if (item.merged !== true)
        throw new Error(
          `GitHub merge was not completed: ${requiredString(item.message, "merge message")}`,
        );
      return {
        sha: requiredString(item.sha, "merge SHA"),
        merged: true,
        message: requiredString(item.message, "merge message"),
      };
    },
  };
}
