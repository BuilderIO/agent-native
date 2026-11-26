import type { DocumentPropertyOptionColor } from "./properties";

/**
 * A collection that follows GitHub pull requests: the ones a GitHub search
 * finds, plus any added by link, one row each. GitHub owns every column, so
 * the rows are view only in Content.
 */
export const GITHUB_PULL_REQUESTS_SOURCE_TYPE = "github-pull-requests";

/** What a new collection follows when the caller names no search. */
export const DEFAULT_GITHUB_PULL_REQUEST_SEARCH = "is:pr is:open author:@me";

/**
 * Most pull requests a search fills a collection with. A search that finds
 * more keeps its rows and says so, rather than move some to Trash.
 */
export const GITHUB_PULL_REQUESTS_MAX_SEARCH_ROWS = 300;

/** Most pull requests one collection keeps because they were added by link. */
export const GITHUB_PULL_REQUESTS_MAX_ADDED = 500;

/** Most links one add takes. */
export const GITHUB_PULL_REQUESTS_MAX_ADD_BATCH = 50;

export type GitHubPullRequestsProblemCode =
  | "connection"
  | "forbidden"
  | "rate_limited"
  | "too_many_results"
  | "unavailable";

export interface GitHubPullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

/** One pull request as GitHub reports it, reduced to what the rows show. */
export interface GitHubPullRequestRecord extends GitHubPullRequestRef {
  title: string;
  url: string;
  author: string | null;
  state: "open" | "closed" | "merged";
  draft: boolean;
  review: "approved" | "changes_requested" | "waiting" | "none";
  checks: "passing" | "failing" | "running" | "none";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9_.-]+$/;

function pullRequestRef(
  owner: string,
  repo: string,
  number: string,
): GitHubPullRequestRef | null {
  const name = repo.replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !REPO.test(name) || name === "." || name === "..")
    return null;
  if (!/^\d+$/.test(number)) return null;
  const value = Number(number);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return { owner, repo: name, number: value };
}

/**
 * Reads a pull request link, like https://github.com/owner/repo/pull/12 with
 * or without a trailing path such as /files, or the short owner/repo#12.
 * Anything else, such as an issue link, is null.
 */
export function parseGitHubPullRequestUrl(
  input: string,
): GitHubPullRequestRef | null {
  const text = input.trim();
  const [, shortOwner, shortRepo, shortNumber] =
    /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/.exec(text) ?? [];
  if (shortOwner && shortRepo && shortNumber) {
    return pullRequestRef(shortOwner, shortRepo, shortNumber);
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    // coercion-ok: text that isn't a URL isn't a pull request link, and null is this function's documented answer for that.
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const [owner, repo, kind, number] = url.pathname.split("/").filter(Boolean);
  if (kind !== "pull" || !owner || !repo || !number) return null;
  return pullRequestRef(owner, repo, number);
}

/** The key a row is known by: GitHub treats owner and repository case-blind. */
export function githubPullRequestKey(ref: GitHubPullRequestRef): string {
  return `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
}

export function githubPullRequestWebUrl(ref: GitHubPullRequestRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
}

/** A search finds issues too unless it asks for pull requests. */
export function githubPullRequestSearchQuery(search: string): string {
  const query = search.trim().replace(/\s+/g, " ");
  return /(^|\s)(is|type):(pr|pull-request)(\s|$)/i.test(query)
    ? query
    : `is:pr ${query}`.trim();
}

/** The source's name, which the Sources panel shows. */
export function githubPullRequestsSourceName(search: string | null): string {
  return search
    ? `GitHub pull requests: ${search}`
    : "GitHub pull requests added by link";
}

export type GitHubPullRequestColumnKey =
  | "repository"
  | "number"
  | "author"
  | "state"
  | "review"
  | "checks"
  | "checksFailing"
  | "opened"
  | "updated"
  | "closed"
  | "daysOpen"
  | "link";

export type GitHubPullRequestColumnType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "url"
  | "select";

export interface GitHubPullRequestColumn {
  key: GitHubPullRequestColumnKey;
  name: string;
  type: GitHubPullRequestColumnType;
  /** Fixed choices, in order; a select without them grows as values arrive. */
  options?: ReadonlyArray<{
    id: string;
    name: string;
    color: DocumentPropertyOptionColor;
  }>;
}

/**
 * The columns GitHub owns, in the order a new collection shows them. The
 * title is the row's page title. "Checks failing" is ticked only for a pull
 * request whose checks fail, so a rollup that counts filled values counts
 * them; "Days open" is empty once a pull request closes, so a rollup's
 * largest value is the oldest open one.
 */
export const GITHUB_PULL_REQUEST_COLUMNS: readonly GitHubPullRequestColumn[] = [
  { key: "repository", name: "Repository", type: "select" },
  { key: "number", name: "Number", type: "number" },
  { key: "author", name: "Author", type: "text" },
  {
    key: "state",
    name: "State",
    type: "select",
    options: [
      { id: "draft", name: "Draft", color: "gray" },
      { id: "open", name: "Open", color: "green" },
      { id: "merged", name: "Merged", color: "purple" },
      { id: "closed", name: "Closed", color: "red" },
    ],
  },
  {
    key: "review",
    name: "Review",
    type: "select",
    options: [
      { id: "approved", name: "Approved", color: "green" },
      { id: "changes-requested", name: "Changes requested", color: "orange" },
      { id: "waiting", name: "Waiting", color: "yellow" },
      { id: "none", name: "None", color: "gray" },
    ],
  },
  {
    key: "checks",
    name: "Checks",
    type: "select",
    options: [
      { id: "passing", name: "Passing", color: "green" },
      { id: "failing", name: "Failing", color: "red" },
      { id: "running", name: "Running", color: "yellow" },
      { id: "none", name: "None", color: "gray" },
    ],
  },
  { key: "checksFailing", name: "Checks failing", type: "checkbox" },
  { key: "opened", name: "Opened", type: "date" },
  { key: "updated", name: "Updated", type: "date" },
  { key: "closed", name: "Closed", type: "date" },
  { key: "daysOpen", name: "Days open", type: "number" },
  { key: "link", name: "Link", type: "url" },
];

const STATE_NAMES = {
  draft: "Draft",
  open: "Open",
  merged: "Merged",
  closed: "Closed",
} as const;
const REVIEW_NAMES = {
  approved: "Approved",
  changes_requested: "Changes requested",
  waiting: "Waiting",
  none: "None",
} as const;
const CHECK_NAMES = {
  passing: "Passing",
  failing: "Failing",
  running: "Running",
  none: "None",
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** GitHub's times are UTC; a row shows the day, which needs no time zone. */
function day(iso: string | null): { start: string } | null {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? { start: iso.slice(0, 10) }
    : null;
}

/** Whole days since a pull request opened, while it's open; null once closed. */
export function githubPullRequestDaysOpen(
  pr: Pick<GitHubPullRequestRecord, "state" | "createdAt">,
  now: number,
): number | null {
  if (pr.state !== "open") return null;
  const opened = Date.parse(pr.createdAt);
  if (!Number.isFinite(opened)) return null;
  return Math.max(0, Math.floor((now - opened) / DAY_MS));
}

/**
 * Whether a row's values can't change any more: merged, with its checks
 * done. A merged pull request can't reopen, so a sync stops reading one
 * added by link once its row shows that.
 */
export function githubPullRequestValuesSettled(
  values: Record<string, unknown>,
): boolean {
  return (
    values.state === STATE_NAMES.merged && values.checks !== CHECK_NAMES.running
  );
}

/** A row's column values, by column key, as of `now`. */
export function githubPullRequestValues(
  pr: GitHubPullRequestRecord,
  now: number,
): Record<GitHubPullRequestColumnKey, unknown> {
  return {
    repository: `${pr.owner}/${pr.repo}`,
    number: pr.number,
    author: pr.author,
    state:
      pr.state === "open" && pr.draft
        ? STATE_NAMES.draft
        : STATE_NAMES[pr.state],
    review: REVIEW_NAMES[pr.review],
    checks: CHECK_NAMES[pr.checks],
    checksFailing: pr.checks === "failing" ? true : null,
    opened: day(pr.createdAt),
    updated: day(pr.updatedAt),
    closed: day(pr.closedAt),
    daysOpen: githubPullRequestDaysOpen(pr, now),
    link: pr.url,
  };
}
