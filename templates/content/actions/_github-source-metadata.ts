import { createHash } from "node:crypto";

import type {
  ContentDatabaseSourceCapabilities,
  ContentGitHubSourceStatus,
} from "../shared/api.js";
import {
  githubFolderWebUrl,
  type GitHubFolderLocation,
  type GitHubSourceProblemCode,
  type GitHubSourceSkipReason,
} from "../shared/github-source.js";

/** Most skipped files a link remembers for its status line. */
const MAX_REMEMBERED_SKIPS = 50;

/**
 * Everything a GitHub link keeps between syncs, stored under `github` in the
 * source's metadata. Rows keep their own blob SHA, so a sync that stops
 * partway resumes by comparing again rather than from a cursor.
 */
export interface GitHubSourceState extends GitHubFolderLocation {
  /** The workspace connection the link reads through. */
  connectionId: string | null;
  /** Who linked the folder; background syncs read GitHub as them. */
  linkedBy: string;
  linkedAt: string;
  mode: "view_only";
  headEtag: string | null;
  syncedCommitSha: string | null;
  syncedAt: string | null;
  checkedAt: string | null;
  pendingCommitSha: string | null;
  progress: { done: number; total: number } | null;
  files: number;
  skipped: Array<{ path: string; reason: GitHubSourceSkipReason }>;
  /** Images rows couldn't store yet because file storage isn't set up. */
  imagesWaiting: number;
  problem: {
    code: GitHubSourceProblemCode;
    message: string;
    at: string;
  } | null;
  /** Lease held by the sync that's running, so two never overlap. */
  claim: { id: string; until: string } | null;
}

export function githubSourceId(databaseId: string, sourceTable: string) {
  return `content_database_source_github_${createHash("sha256")
    .update(`${databaseId}:${sourceTable}`)
    .digest("hex")
    .slice(0, 32)}`;
}

/** View only: Content reads the folder and never writes to it. */
export function githubSourceCapabilities(): ContentDatabaseSourceCapabilities {
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

export function githubSourceMetadataRecord(state: GitHubSourceState) {
  return {
    primaryKey: "path",
    titleField: "title",
    naturalKeyField: null,
    pushMode: "none",
    pushModeLabel: "View only",
    pushModeDescription:
      "Rows follow the GitHub folder. Edit the files in GitHub; Content updates after each push.",
    readMode: "github-api",
    connectionId: state.connectionId,
    notes:
      "Each Markdown file is a row. Frontmatter fields are read-only columns; Content-only columns and comments stay editable.",
    github: state,
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

export function readGitHubSourceState(
  metadata: unknown,
): GitHubSourceState | null {
  const github = asRecord(asRecord(metadata)?.github);
  if (
    !github ||
    typeof github.owner !== "string" ||
    typeof github.repo !== "string" ||
    typeof github.branch !== "string" ||
    typeof github.path !== "string"
  ) {
    return null;
  }
  const progress = asRecord(github.progress);
  const problem = asRecord(github.problem);
  const claim = asRecord(github.claim);
  return {
    owner: github.owner,
    repo: github.repo,
    branch: github.branch,
    path: github.path,
    connectionId: stringOrNull(github.connectionId),
    linkedBy: typeof github.linkedBy === "string" ? github.linkedBy : "",
    linkedAt: typeof github.linkedAt === "string" ? github.linkedAt : "",
    mode: "view_only",
    headEtag: stringOrNull(github.headEtag),
    syncedCommitSha: stringOrNull(github.syncedCommitSha),
    syncedAt: stringOrNull(github.syncedAt),
    checkedAt: stringOrNull(github.checkedAt),
    pendingCommitSha: stringOrNull(github.pendingCommitSha),
    progress:
      progress &&
      typeof progress.done === "number" &&
      typeof progress.total === "number"
        ? { done: progress.done, total: progress.total }
        : null,
    files: typeof github.files === "number" ? github.files : 0,
    skipped: (Array.isArray(github.skipped) ? github.skipped : []).flatMap(
      (raw) => {
        const skip = asRecord(raw);
        return skip &&
          typeof skip.path === "string" &&
          (skip.reason === "mdx" ||
            skip.reason === "too-large" ||
            skip.reason === "not-text")
          ? [{ path: skip.path, reason: skip.reason }]
          : [];
      },
    ),
    imagesWaiting:
      typeof github.imagesWaiting === "number" ? github.imagesWaiting : 0,
    problem:
      problem &&
      typeof problem.code === "string" &&
      typeof problem.message === "string"
        ? {
            code: problem.code as GitHubSourceProblemCode,
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

export function rememberedSkips(
  skipped: Array<{ path: string; reason: GitHubSourceSkipReason }>,
) {
  return skipped.slice(0, MAX_REMEMBERED_SKIPS);
}

/** The status agents and the status line read; never includes the claim. */
export function githubSourceStatus(
  metadata: unknown,
): ContentGitHubSourceStatus | undefined {
  const state = readGitHubSourceState(metadata);
  if (!state) return undefined;
  return {
    owner: state.owner,
    repo: state.repo,
    branch: state.branch,
    path: state.path,
    folderUrl: githubFolderWebUrl(state),
    mode: state.mode,
    syncedCommitSha: state.syncedCommitSha,
    syncedAt: state.syncedAt,
    checkedAt: state.checkedAt,
    pendingCommitSha: state.pendingCommitSha,
    progress: state.progress,
    files: state.files,
    skipped: state.skipped,
    imagesWaiting: state.imagesWaiting,
    problem: state.problem,
  };
}
