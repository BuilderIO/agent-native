import { actionErrorMessage } from "@agent-native/core/client/hooks";
import {
  GITHUB_SOURCE_MAX_FILES,
  parseGitHubFolderUrl,
  type GitHubLinkBlockedReason,
  type GitHubSourceProblemCode,
  type GitHubSourceSkipReason,
} from "@shared/github-source";

import { dbText, type DatabaseMessageKey } from "./text";

const PROBLEM_KEYS: Record<GitHubSourceProblemCode, DatabaseMessageKey> = {
  connection: "githubProblemConnection",
  forbidden: "githubProblemForbidden",
  repository_not_found: "githubProblemRepositoryNotFound",
  branch_not_found: "githubProblemBranchNotFound",
  folder_not_found: "githubProblemFolderNotFound",
  rate_limited: "githubProblemPaused",
  too_large: "githubProblemTooLarge",
  unavailable: "githubProblemPaused",
  sync_failed: "githubProblemPaused",
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

/** Where a linked folder lives, for problem text that names it. */
export interface GitHubProblemPlace {
  branch?: string;
  path?: string;
}

/** A linked folder's problem, as the status line and update toasts say it. */
export function githubProblemText(
  code: GitHubSourceProblemCode,
  place: GitHubProblemPlace = {},
): string {
  return dbText(PROBLEM_KEYS[code] ?? "githubProblemPaused", {
    branch: place.branch ?? "",
    folder: lastSegment(place.path ?? ""),
    max: GITHUB_SOURCE_MAX_FILES.toLocaleString(pageLocale()),
  });
}

/** Problems that mean nothing comes in until someone acts. */
export function githubProblemStopsUpdates(
  code: GitHubSourceProblemCode,
): boolean {
  return (
    code === "connection" ||
    code === "forbidden" ||
    code === "repository_not_found" ||
    code === "branch_not_found" ||
    code === "folder_not_found" ||
    code === "too_large"
  );
}

/**
 * The problem a `GITHUB_<CODE>` action error stands for, so the dialog can say
 * it in the reader's language. Null for any other error.
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

/** Whether an action error means GitHub needs connecting first. */
export function githubErrorNeedsConnection(error: unknown): boolean {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  // A missing or ungranted connection comes from the shared provider runtime
  // as `connection_required`; a rejected one, from GitHub.
  return (
    code === "connection_required" ||
    githubProblemFromErrorCode(code) === "connection"
  );
}

/** The collection-level reason a link was refused, from its action error. */
export function githubBlockedFromErrorCode(
  errorCode: unknown,
): GitHubLinkBlockedReason | null {
  if (errorCode === "COLLECTION_NOT_EMPTY") return "collection-has-rows";
  if (errorCode === "SOURCE_ALREADY_LINKED") return "already-linked";
  if (errorCode === "COLLECTION_NOT_LINKABLE") return "system-collection";
  return null;
}

/**
 * A link-time error in plain words, naming what the person typed: a typo in
 * the link reads as a typo, not as something that went missing.
 */
export function githubLinkErrorText(error: unknown, url: string): string {
  const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
  const blocked = githubBlockedFromErrorCode(errorCode);
  if (blocked) return githubBlockedText(blocked);
  const problem = githubProblemFromErrorCode(errorCode);
  if (!problem) {
    return (
      actionErrorMessage(error) ??
      (error instanceof Error ? error.message : dbText("githubLinkUnavailable"))
    );
  }
  const parsed = parseGitHubFolderUrl(url);
  const repo = parsed.ok ? parsed.repo : "";
  const [branch = "", ...folder] = parsed.ok ? parsed.refPath : [];
  switch (problem) {
    case "repository_not_found":
      return dbText("githubLinkRepositoryNotFound", { repo });
    case "forbidden":
      return dbText("githubLinkForbidden", { repo });
    case "branch_not_found":
      return dbText("githubLinkBranchNotFound", { branch, repo });
    case "folder_not_found":
      return dbText("githubLinkFolderNotFound", {
        folder: folder.join("/"),
        repo,
      });
    case "too_large":
      return dbText("githubLinkTooLarge", {
        max: GITHUB_SOURCE_MAX_FILES.toLocaleString(pageLocale()),
      });
    default:
      return dbText("githubLinkUnavailable");
  }
}

/** What's wrong with a link before anything is sent, if anything. */
export function githubUrlProblem(
  url: string,
): { text: string; folderUrl: string | null; folder: string | null } | null {
  const parsed = parseGitHubFolderUrl(url);
  if (parsed.ok) return null;
  if (parsed.reason !== "file") {
    return {
      text: dbText("githubLinkInvalidUrl"),
      folderUrl: null,
      folder: null,
    };
  }
  const folder = fileLinkFolder(url);
  return {
    text: dbText("githubLinkFileUrl"),
    folderUrl: folder?.url ?? null,
    folder: folder?.name ?? null,
  };
}

/**
 * The folder a file link points into: `…/blob/main/docs/faq.md` becomes
 * `…/tree/main/docs`, named "docs", or the repository at its root.
 */
export function fileLinkFolder(
  url: string,
): { url: string; name: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`,
    );
    // coercion-ok: a link that isn't a URL has no folder to offer; the caller shows the invalid-link text.
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const [owner, repo, kind, ...rest] = segments;
  if (!owner || !repo || kind !== "blob" || rest.length < 2) return null;
  const folderSegments = rest.slice(0, -1);
  const folderUrl = `https://github.com/${owner}/${repo}/tree/${folderSegments.join("/")}`;
  // The first segment is the branch, so a file at the root names the repository.
  const name =
    folderSegments.length > 1
      ? decodeURIComponent(folderSegments[folderSegments.length - 1]!)
      : decodeURIComponent(repo);
  return parseGitHubFolderUrl(folderUrl).ok ? { url: folderUrl, name } : null;
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

function lastSegment(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The page's language, for numbers, dates and lists. */
export function pageLocale(): string {
  return typeof document === "undefined" || !document.documentElement.lang
    ? "en-US"
    : document.documentElement.lang;
}

// Not in the TypeScript lib this app targets, though every supported
// browser has it.
const ListFormat = (
  Intl as typeof Intl & {
    ListFormat?: new (
      locale: string,
      options: { style: "long"; type: "conjunction" },
    ) => { format(items: string[]): string };
  }
).ListFormat;

/** "API reference, FAQ and Getting started", in the page's language. */
export function githubList(items: string[]): string {
  if (!ListFormat) return items.join(", ");
  return new ListFormat(pageLocale(), {
    style: "long",
    type: "conjunction",
  }).format(items);
}

/**
 * The first few names and a count of the rest: "FAQ, Guide and 3 more".
 * `total` counts names that weren't sent too.
 */
export function githubListWithMore(
  names: string[],
  total: number,
  shown = 3,
): string {
  const visible = names.slice(0, shown);
  const more = total - visible.length;
  return githubList(
    more > 0
      ? [...visible, dbText("githubLinkMore", { count: more })]
      : visible,
  );
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
  const format = new Intl.RelativeTimeFormat(pageLocale(), {
    numeric: "auto",
  });
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return dbText("githubJustNow");
}

/** A frontmatter example the way a writer reads it: "Yes", "Sep 15, 2026". */
export function githubExampleText(type: string, example: string): string {
  if (type === "checkbox") {
    if (example === "true") return dbText("githubYes");
    if (example === "false") return dbText("githubNo");
  }
  if (type === "date") {
    const at = Date.parse(example);
    if (Number.isFinite(at)) {
      return new Intl.DateTimeFormat(pageLocale(), {
        dateStyle: "medium",
        // Frontmatter dates are calendar days, so they mustn't shift by zone.
        timeZone: /^\d{4}-\d{2}-\d{2}$/.test(example) ? "UTC" : undefined,
      }).format(at);
    }
  }
  return example;
}
