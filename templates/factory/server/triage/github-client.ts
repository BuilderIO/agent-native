import { resolveConnectorSecret } from "../connectors/credentials.js";

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
    userLogin: requiredString(user.login, "pull request author"),
    headSha: requiredString(head.sha, "pull request head SHA"),
    headRef: requiredString(head.ref, "pull request head branch"),
    baseRef: requiredString(base.ref, "pull request base ref"),
    createdAt: requiredString(item.created_at, "pull request created time"),
    updatedAt: requiredString(item.updated_at, "pull request updated time"),
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
    const response = (await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${await token()}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    })) as JsonResponse;
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `GitHub API request failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`,
      );
    }
    if (response.status === 204 && options.allowEmpty) return undefined as T;
    return (await response.json()) as T;
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

    async getPullRequestSummary(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
    ) {
      if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) {
        throw new Error(
          "GitHub pull request number must be a positive integer",
        );
      }
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
      } satisfies GitHubPullRequestSummary;
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

    async approvePullRequest(
      repository: GitHubRepositoryRef,
      pullRequestNumber: number,
      body?: string,
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
