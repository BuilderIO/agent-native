// GitHub API client — REST v3 + GraphQL v4
// Auth: GITHUB_TOKEN (personal access token or GitHub App token)
// Mirrors patterns from server/lib/gong.ts

import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";
import { getGitHubAccessToken } from "./github-oauth";

const REST_BASE = "https://api.github.com";
const GRAPHQL_URL = "https://api.github.com/graphql";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 200;

async function getToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("GITHUB_TOKEN");
  const { token } = await getGitHubAccessToken(ctx);
  if (!token) throw new Error("GitHub is not connected");
  return token;
}

async function getHeaders(accept?: string): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getToken()}`,
    Accept: accept ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function restGet<T>(
  path: string,
  cacheKey?: string,
  accept?: string,
): Promise<T> {
  const key = scopedCredentialCacheKey(cacheKey ?? path, "GITHUB_TOKEN");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data as T;

  const res = await fetch(`${REST_BASE}${path}`, {
    headers: await getHeaders(accept),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub REST error ${res.status}: ${text}`);
  }
  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

async function restGetPaginated<T>(path: string, maxPages = 10): Promise<T[]> {
  const results: T[] = [];
  let url: string | null =
    `${REST_BASE}${path}${path.includes("?") ? "&" : "?"}per_page=100`;

  for (let page = 0; page < maxPages && url; page++) {
    const res = await fetch(url, { headers: await getHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub REST error ${res.status}: ${text}`);
    }
    const data: T[] = await res.json();
    results.push(...data);

    // Parse Link header for next page
    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }
  return results;
}

async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const body = JSON.stringify({ query, variables });
  const key = scopedCredentialCacheKey(
    `gql:${query}:${JSON.stringify(variables)}`,
    "GITHUB_TOKEN",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data as T;

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: await getHeaders(),
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GraphQL error ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  cacheSet(key, json.data);
  return json.data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubPR {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  closedAt?: string;
  body?: string;
  labels: string[];
  reviewState?: string; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | etc.
  draft: boolean;
  baseRef: string;
  headRef: string;
  repo: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  body?: string;
  labels: string[];
  assignees: string[];
  repo: string;
  comments: number;
}

export interface GitHubPRDetail extends GitHubPR {
  commits: { sha: string; message: string; author: string; date: string }[];
  reviews: {
    author: string;
    state: string;
    submittedAt: string;
    body?: string;
  }[];
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }[];
  comments: number;
  additions: number;
  deletions: number;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** GitHub search query — all qualifiers supported (org:, repo:, author:, etc.) */
  query: string;
  /** "pr" | "issue" (default: "pr") */
  type?: "pr" | "issue";
  /** max results to return (default: 30, max: 100) */
  limit?: number;
}

interface RawSearchItem {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  body?: string;
  labels: { name: string }[];
  draft?: boolean;
  pull_request?: { merged_at?: string | null };
  assignees?: { login: string }[];
  comments?: number;
  repository_url?: string;
}

function repoNameFromUrl(url?: string): string {
  if (!url) return "";
  return url.replace("https://api.github.com/repos/", "");
}

export async function searchPRs(opts: SearchOptions): Promise<GitHubPR[]> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const q =
    opts.type === "issue" ? `${opts.query} is:issue` : `${opts.query} is:pr`;

  const data = await restGet<{ items: RawSearchItem[] }>(
    `/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}&sort=updated&order=desc`,
    `search:${q}:${limit}`,
  );

  return (data.items ?? []).map((item) => ({
    number: item.number,
    title: item.title,
    state: item.pull_request?.merged_at
      ? "merged"
      : (item.state as "open" | "closed"),
    url: item.html_url,
    author: item.user?.login ?? "",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    mergedAt: item.pull_request?.merged_at ?? item.merged_at,
    closedAt: item.closed_at ?? undefined,
    body: item.body ?? undefined,
    labels: item.labels.map((l) => l.name),
    draft: item.draft ?? false,
    baseRef: "",
    headRef: "",
    repo: repoNameFromUrl(item.repository_url),
  }));
}

export async function searchIssues(
  opts: SearchOptions,
): Promise<GitHubIssue[]> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const q = `${opts.query} is:issue`;

  const data = await restGet<{ items: RawSearchItem[] }>(
    `/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}&sort=updated&order=desc`,
    `search-issues:${q}:${limit}`,
  );

  return (data.items ?? []).map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state as "open" | "closed",
    url: item.html_url,
    author: item.user?.login ?? "",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    closedAt: item.closed_at ?? undefined,
    body: item.body ?? undefined,
    labels: item.labels.map((l) => l.name),
    assignees: (item.assignees ?? []).map((a) => a.login),
    repo: repoNameFromUrl(item.repository_url),
    comments: item.comments ?? 0,
  }));
}

// ─── PR detail ────────────────────────────────────────────────────────────────

export async function getPR(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubPRDetail> {
  const [pr, commits, reviews, files] = await Promise.all([
    restGet<Record<string, unknown>>(
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
    ),
    restGet<Record<string, unknown>[]>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/commits`,
    ),
    restGet<Record<string, unknown>[]>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    ),
    restGet<Record<string, unknown>[]>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files`,
    ),
  ]);

  const state = pr.merged_at
    ? "merged"
    : pr.state === "closed"
      ? "closed"
      : "open";

  return {
    number: pr.number as number,
    title: pr.title as string,
    state,
    url: pr.html_url as string,
    author: (pr.user as { login: string })?.login ?? "",
    createdAt: pr.created_at as string,
    updatedAt: pr.updated_at as string,
    mergedAt: pr.merged_at as string | undefined,
    closedAt: pr.closed_at as string | undefined,
    body: pr.body as string | undefined,
    labels: ((pr.labels as { name: string }[]) ?? []).map((l) => l.name),
    draft: pr.draft as boolean,
    baseRef: (pr.base as { ref: string })?.ref ?? "",
    headRef: (pr.head as { ref: string })?.ref ?? "",
    repo: `${owner}/${repo}`,
    comments: (pr.comments as number) ?? 0,
    additions: (pr.additions as number) ?? 0,
    deletions: (pr.deletions as number) ?? 0,
    commits: commits.map((c: Record<string, unknown>) => ({
      sha: (c.sha as string).slice(0, 7),
      message: (
        ((c.commit as Record<string, unknown>)?.message as string) ?? ""
      ).split("\n")[0],
      author:
        ((c.commit as Record<string, unknown>)?.author as { name?: string })
          ?.name ??
        (c.author as { login?: string })?.login ??
        "",
      date:
        ((c.commit as Record<string, unknown>)?.author as { date?: string })
          ?.date ?? "",
    })),
    reviews: reviews.map((r: Record<string, unknown>) => ({
      author: (r.user as { login: string })?.login ?? "",
      state: r.state as string,
      submittedAt: r.submitted_at as string,
      body: r.body as string | undefined,
    })),
    files: files.map((f: Record<string, unknown>) => ({
      filename: f.filename as string,
      status: f.status as string,
      additions: f.additions as number,
      deletions: f.deletions as number,
    })),
  };
}

// ─── Issue detail ─────────────────────────────────────────────────────────────

export async function getIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssue> {
  const issue = await restGet<Record<string, unknown>>(
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
  );
  return {
    number: issue.number as number,
    title: issue.title as string,
    state: issue.state as "open" | "closed",
    url: issue.html_url as string,
    author: (issue.user as { login: string })?.login ?? "",
    createdAt: issue.created_at as string,
    updatedAt: issue.updated_at as string,
    closedAt: issue.closed_at as string | undefined,
    body: issue.body as string | undefined,
    labels: ((issue.labels as { name: string }[]) ?? []).map((l) => l.name),
    assignees: ((issue.assignees as { login: string }[]) ?? []).map(
      (a) => a.login,
    ),
    repo: `${owner}/${repo}`,
    comments: (issue.comments as number) ?? 0,
  };
}

// ─── List repo PRs ────────────────────────────────────────────────────────────

export async function listPRs(
  owner: string,
  repo: string,
  opts: { state?: "open" | "closed" | "all"; limit?: number } = {},
): Promise<GitHubPR[]> {
  const state = opts.state ?? "open";
  const limit = Math.min(opts.limit ?? 30, 100);
  const items = await restGet<Record<string, unknown>[]>(
    `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${limit}&sort=updated&direction=desc`,
    `list-prs:${owner}/${repo}:${state}:${limit}`,
  );

  return items.map((pr) => ({
    number: pr.number as number,
    title: pr.title as string,
    state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
    url: pr.html_url as string,
    author: (pr.user as { login: string })?.login ?? "",
    createdAt: pr.created_at as string,
    updatedAt: pr.updated_at as string,
    mergedAt: pr.merged_at as string | undefined,
    closedAt: pr.closed_at as string | undefined,
    body: pr.body as string | undefined,
    labels: ((pr.labels as { name: string }[]) ?? []).map((l) => l.name),
    draft: pr.draft as boolean,
    baseRef: (pr.base as { ref: string })?.ref ?? "",
    headRef: (pr.head as { ref: string })?.ref ?? "",
    repo: `${owner}/${repo}`,
  }));
}

// ─── GraphQL — arbitrary query ────────────────────────────────────────────────

export async function runGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return graphql<T>(query, variables);
}

// ─── Org-wide PR search (via GraphQL) ────────────────────────────────────────

export async function searchOrgPRs(opts: {
  org: string;
  query?: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  limit?: number;
}): Promise<GitHubPR[]> {
  const { org, query = "", state, limit = 30 } = opts;

  // Build search string
  const stateQ = state ? ` is:${state.toLowerCase()}` : "";
  const q = `org:${org} is:pr ${query}${stateQ}`.trim();

  return searchPRs({ query: q, type: "pr", limit });
}

// ─── Repositories and code search ───────────────────────────────────────────

export interface GitHubRepository {
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  description?: string;
  language?: string;
  updatedAt: string;
  url: string;
}

export interface GitHubCodeSearchResult {
  repo: string;
  path: string;
  name: string;
  sha: string;
  url: string;
  score: number;
  textMatches: Array<{
    fragment: string;
    matches: Array<{ text: string; indices: [number, number] }>;
  }>;
}

export interface GitHubFileContent {
  repo: string;
  path: string;
  ref?: string;
  sha?: string;
  size?: number;
  encoding?: string;
  content?: string;
  truncated?: boolean;
  entries?: Array<{
    name: string;
    path: string;
    type: string;
    size?: number;
    sha?: string;
    url?: string;
  }>;
}

interface RawRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  fork: boolean;
  archived: boolean;
  default_branch: string;
  description?: string | null;
  language?: string | null;
  updated_at: string;
  html_url: string;
}

interface RawCodeSearchItem {
  name: string;
  path: string;
  sha: string;
  html_url: string;
  score: number;
  repository: { full_name: string };
  text_matches?: Array<{
    fragment?: string;
    matches?: Array<{ text?: string; indices?: [number, number] }>;
  }>;
}

interface RawContentItem {
  type?: string;
  name?: string;
  path?: string;
  sha?: string;
  size?: number;
  html_url?: string;
  encoding?: string;
  content?: string;
}

function mapRepository(repo: RawRepo): GitHubRepository {
  return {
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login ?? repo.full_name.split("/")[0] ?? "",
    private: repo.private,
    fork: repo.fork,
    archived: repo.archived,
    defaultBranch: repo.default_branch,
    description: repo.description ?? undefined,
    language: repo.language ?? undefined,
    updatedAt: repo.updated_at,
    url: repo.html_url,
  };
}

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name || repo.split("/").length !== 2) {
    throw new Error("repo must be in owner/repo format");
  }
  return { owner, name };
}

function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export async function listRepos(
  opts: {
    query?: string;
    visibility?: "all" | "public" | "private";
    limit?: number;
  } = {},
): Promise<GitHubRepository[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const visibility = opts.visibility ?? "all";
  const data = await restGet<RawRepo[]>(
    `/user/repos?per_page=${limit}&sort=updated&direction=desc&visibility=${visibility}&affiliation=owner,collaborator,organization_member`,
    `repos:${visibility}:${limit}`,
  );
  const repos = data.map(mapRepository);
  const query = opts.query?.trim().toLowerCase();
  if (!query) return repos;
  return repos.filter((repo) => {
    return (
      repo.fullName.toLowerCase().includes(query) ||
      repo.name.toLowerCase().includes(query) ||
      (repo.description ?? "").toLowerCase().includes(query)
    );
  });
}

export async function getRepo(
  owner: string,
  repo: string,
): Promise<GitHubRepository> {
  return mapRepository(
    await restGet<RawRepo>(`/repos/${owner}/${repo}`, `repo:${owner}/${repo}`),
  );
}

export async function searchCode(opts: {
  query: string;
  repo?: string;
  org?: string;
  user?: string;
  path?: string;
  extension?: string;
  filename?: string;
  limit?: number;
}): Promise<GitHubCodeSearchResult[]> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const parts = [opts.query.trim()];
  if (!parts[0]) throw new Error("query is required");
  if (opts.repo) parts.push(`repo:${opts.repo}`);
  if (opts.org) parts.push(`org:${opts.org}`);
  if (opts.user) parts.push(`user:${opts.user}`);
  if (opts.path) parts.push(`path:${opts.path}`);
  if (opts.extension) parts.push(`extension:${opts.extension}`);
  if (opts.filename) parts.push(`filename:${opts.filename}`);
  const q = parts.join(" ");
  const data = await restGet<{ items: RawCodeSearchItem[] }>(
    `/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`,
    `code:${q}:${limit}`,
    "application/vnd.github.text-match+json",
  );

  return (data.items ?? []).map((item) => ({
    repo: item.repository?.full_name ?? "",
    path: item.path,
    name: item.name,
    sha: item.sha,
    url: item.html_url,
    score: item.score,
    textMatches: (item.text_matches ?? []).map((match) => ({
      fragment: match.fragment ?? "",
      matches: (match.matches ?? []).map((m) => ({
        text: m.text ?? "",
        indices: m.indices ?? [0, 0],
      })),
    })),
  }));
}

export async function getFileContent(opts: {
  repo: string;
  path: string;
  ref?: string;
  maxBytes?: number;
}): Promise<GitHubFileContent> {
  const { owner, name } = parseRepo(opts.repo);
  const encodedPath = encodeRepoPath(opts.path);
  const refQuery = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : "";
  const data = await restGet<RawContentItem | RawContentItem[]>(
    `/repos/${owner}/${name}/contents/${encodedPath}${refQuery}`,
    `content:${opts.repo}:${opts.path}:${opts.ref ?? ""}`,
  );

  if (Array.isArray(data)) {
    return {
      repo: opts.repo,
      path: opts.path,
      ref: opts.ref,
      entries: data.map((entry) => ({
        name: entry.name ?? "",
        path: entry.path ?? "",
        type: entry.type ?? "",
        size: entry.size,
        sha: entry.sha,
        url: entry.html_url,
      })),
    };
  }

  if (data.type !== "file") {
    return {
      repo: opts.repo,
      path: opts.path,
      ref: opts.ref,
      sha: data.sha,
      size: data.size,
      encoding: data.encoding,
    };
  }

  const rawContent =
    data.encoding === "base64" && data.content
      ? Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8")
      : (data.content ?? "");
  const maxBytes = Math.min(opts.maxBytes ?? 80_000, 200_000);
  const truncated = Buffer.byteLength(rawContent, "utf8") > maxBytes;
  const content = truncated ? rawContent.slice(0, maxBytes) : rawContent;

  return {
    repo: opts.repo,
    path: opts.path,
    ref: opts.ref,
    sha: data.sha,
    size: data.size,
    encoding: data.encoding,
    content,
    truncated,
  };
}
