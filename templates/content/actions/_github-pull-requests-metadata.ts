import { createHash } from "node:crypto";

import type {
  ContentDatabaseSourceCapabilities,
  ContentGitHubPullRequestsSourceStatus,
} from "../shared/api.js";
import {
  githubPullRequestSearchQuery,
  type GitHubPullRequestsProblemCode,
} from "../shared/github-pull-requests.js";

/**
 * Everything a pull request link keeps between syncs, stored under
 * `githubPullRequests` in the source's metadata.
 */
export interface GitHubPullRequestsState {
  /** The GitHub search the rows follow, or null to keep only added ones. */
  search: string | null;
  /**
   * Keys of pull requests added by link. They stay after they leave the
   * search, such as when they merge, so a relation to one keeps its row.
   */
  added: string[];
  /** The workspace connection the link reads through. */
  connectionId: string | null;
  /** Who linked it; every sync reads GitHub as them. */
  linkedBy: string;
  /** The workspace they linked it from, where their GitHub connection is saved. */
  linkedOrgId: string | null;
  linkedAt: string;
  mode: "view_only";
  /** Last time a sync asked GitHub, whether or not it got an answer. */
  checkedAt: string | null;
  /** Last time a sync brought every row up to date. */
  syncedAt: string | null;
  /** Rows the collection had after the last sync. */
  rows: number;
  /** How many pull requests the search found in all at the last sync. */
  searchTotal: number | null;
  problem: {
    code: GitHubPullRequestsProblemCode;
    message: string;
    at: string;
  } | null;
  /** Lease held by the sync that's running, so two never overlap. */
  claim: { id: string; until: string } | null;
}

/** One link per collection, so the id follows the collection. */
export function githubPullRequestsSourceId(databaseId: string) {
  return `content_database_source_github_prs_${createHash("sha256")
    .update(databaseId)
    .digest("hex")
    .slice(0, 32)}`;
}

/** View only: Content reads pull requests and never writes to GitHub. */
export function githubPullRequestsSourceCapabilities(): ContentDatabaseSourceCapabilities {
  return {
    canRefresh: true,
    canCreateChangeSets: false,
    canWriteFields: false,
    canWriteBody: false,
    canPush: false,
    canPull: true,
    canPublish: false,
    canDelete: false,
    canStageLocalRevision: false,
    liveWritesEnabled: false,
    readOnlyRefresh: true,
  };
}

export function githubPullRequestsMetadataRecord(
  state: GitHubPullRequestsState,
) {
  return {
    primaryKey: "pullRequest",
    titleField: "title",
    naturalKeyField: null,
    pushMode: "none",
    pushModeLabel: "View only",
    pushModeDescription:
      "Rows follow GitHub. Change a pull request in GitHub; Content updates within about a minute while the collection is open, and within five minutes otherwise.",
    readMode: "github-api",
    connectionId: state.connectionId,
    notes:
      "Each pull request is a row. GitHub owns its columns; Content-only columns, page text and comments stay editable.",
    githubPullRequests: state,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

const PROBLEM_CODES = new Set<GitHubPullRequestsProblemCode>([
  "connection",
  "forbidden",
  "rate_limited",
  "too_many_results",
  "unavailable",
]);

export function readGitHubPullRequestsState(
  metadata: unknown,
): GitHubPullRequestsState | null {
  const state = asRecord(asRecord(metadata)?.githubPullRequests);
  if (!state || typeof state.linkedBy !== "string") return null;
  const problem = asRecord(state.problem);
  const claim = asRecord(state.claim);
  return {
    search: stringOrNull(state.search),
    added: (Array.isArray(state.added) ? state.added : []).filter(
      (key): key is string => typeof key === "string" && !!key,
    ),
    connectionId: stringOrNull(state.connectionId),
    linkedBy: state.linkedBy,
    linkedOrgId: stringOrNull(state.linkedOrgId),
    linkedAt: typeof state.linkedAt === "string" ? state.linkedAt : "",
    mode: "view_only",
    checkedAt: stringOrNull(state.checkedAt),
    syncedAt: stringOrNull(state.syncedAt),
    rows: typeof state.rows === "number" ? state.rows : 0,
    searchTotal:
      typeof state.searchTotal === "number" ? state.searchTotal : null,
    problem:
      problem &&
      typeof problem.code === "string" &&
      PROBLEM_CODES.has(problem.code as GitHubPullRequestsProblemCode) &&
      typeof problem.message === "string"
        ? {
            code: problem.code as GitHubPullRequestsProblemCode,
            message: problem.message,
            at: typeof problem.at === "string" ? problem.at : "",
          }
        : null,
    claim:
      claim && typeof claim.id === "string" && typeof claim.until === "string"
        ? { id: claim.id, until: claim.until }
        : null,
  };
}

/** The status agents and the Sources panel read; never includes the claim. */
export function githubPullRequestsSourceStatus(
  metadata: unknown,
): ContentGitHubPullRequestsSourceStatus | undefined {
  const state = readGitHubPullRequestsState(metadata);
  if (!state) return undefined;
  return {
    search: state.search,
    searchUrl: state.search
      ? `https://github.com/pulls?q=${encodeURIComponent(githubPullRequestSearchQuery(state.search))}`
      : null,
    added: state.added.length,
    mode: state.mode,
    checkedAt: state.checkedAt,
    syncedAt: state.syncedAt,
    rows: state.rows,
    searchTotal: state.searchTotal,
    problem: state.problem,
  };
}
