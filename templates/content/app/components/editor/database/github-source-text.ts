import type {
  GitHubLinkBlockedReason,
  GitHubSourceProblemCode,
  GitHubSourceSkipReason,
} from "@shared/github-source";

import { dbText, type DatabaseMessageKey } from "./text";

const PROBLEM_KEYS: Record<GitHubSourceProblemCode, DatabaseMessageKey> = {
  connection: "githubProblemConnection",
  forbidden: "githubProblemForbidden",
  repository_not_found: "githubProblemRepositoryNotFound",
  branch_not_found: "githubProblemBranchNotFound",
  folder_not_found: "githubProblemFolderNotFound",
  rate_limited: "githubProblemRateLimited",
  too_large: "githubProblemTooLarge",
  unavailable: "githubProblemUnavailable",
  storage_unavailable: "githubProblemStorageUnavailable",
};

const SKIP_KEYS: Record<GitHubSourceSkipReason, DatabaseMessageKey> = {
  mdx: "githubSkipMdx",
  "too-large": "githubSkipTooLarge",
  "not-text": "githubSkipNotText",
};

const BLOCKED_KEYS: Record<GitHubLinkBlockedReason, DatabaseMessageKey> = {
  "collection-has-rows": "githubLinkBlockedHasRows",
  "already-linked": "githubLinkBlockedLinked",
  "system-collection": "githubLinkBlockedSystem",
};

export function githubProblemText(code: GitHubSourceProblemCode): string {
  return dbText(PROBLEM_KEYS[code] ?? "githubProblemUnavailable");
}

/**
 * The problem a `GITHUB_<CODE>` action error stands for, so the link dialog
 * can say it in the reader's language. Null for any other error.
 */
export function githubProblemFromErrorCode(
  errorCode: unknown,
): GitHubSourceProblemCode | null {
  if (typeof errorCode !== "string" || !errorCode.startsWith("GITHUB_")) {
    return null;
  }
  const code = errorCode.slice("GITHUB_".length).toLowerCase();
  return code in PROBLEM_KEYS ? (code as GitHubSourceProblemCode) : null;
}

export function githubSkipReasonText(reason: GitHubSourceSkipReason): string {
  return dbText(SKIP_KEYS[reason] ?? "githubSkipNotText");
}

export function githubBlockedText(reason: GitHubLinkBlockedReason): string {
  return dbText(BLOCKED_KEYS[reason] ?? "githubLinkBlockedLinked");
}

/** The seven-character commit name GitHub shows. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "2 minutes ago", "just now" and the like, in the page's language. */
export function githubRelativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const locale =
    typeof document === "undefined" || !document.documentElement.lang
      ? "en-US"
      : document.documentElement.lang;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return format.format(0, "second");
}
