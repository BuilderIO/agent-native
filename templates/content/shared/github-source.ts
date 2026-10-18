import type { DocumentPropertyType } from "./properties";

export const GITHUB_SOURCE_TYPE = "github" as const;

/** Largest Markdown file a GitHub link reads; bigger files are skipped. */
export const GITHUB_SOURCE_MAX_MARKDOWN_BYTES = 1024 * 1024;
/** Largest image a GitHub link copies into Content storage. */
export const GITHUB_SOURCE_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Most Markdown files one link syncs. */
export const GITHUB_SOURCE_MAX_FILES = 2_000;

export interface GitHubFolderLocation {
  owner: string;
  repo: string;
  branch: string;
  /** Folder inside the repository, without leading or trailing slashes. Empty is the root. */
  path: string;
}

export type GitHubFolderUrlParse =
  | {
      ok: true;
      owner: string;
      repo: string;
      /**
       * Segments after `/tree/`: a branch name, then the folder. A branch can
       * contain slashes, so the split is settled against the repository.
       */
      refPath: string[];
    }
  | { ok: false; reason: "not-github" | "file" | "invalid" };

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
    // coercion-ok: null means a malformed escape, which the caller reports as "invalid".
  } catch {
    return null;
  }
}

/**
 * Reads a pasted GitHub folder address: a `github.com/<owner>/<repo>` URL,
 * optionally with `/tree/<branch>/<folder>`, or the `<owner>/<repo>`
 * shorthand. A file URL (`/blob/`) is refused so the caller can ask for its
 * folder instead.
 */
export function parseGitHubFolderUrl(input: string): GitHubFolderUrlParse {
  let text = input.trim();
  if (!text) return { ok: false, reason: "invalid" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // Owners can't contain dots, so a first segment without one is the
    // `<owner>/<repo>` shorthand rather than a host name.
    const firstSegment = text.split("/")[0] ?? "";
    text = firstSegment.includes(".")
      ? `https://${text}`
      : `https://github.com/${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return { ok: false, reason: "not-github" };
  }
  const segments: string[] = [];
  for (const raw of url.pathname.split("/")) {
    if (!raw) continue;
    const segment = decodeSegment(raw);
    // A decoded `%2F` or `%5C` would hide a separator, and with it a `..`,
    // inside one segment.
    if (
      segment === null ||
      segment === "." ||
      segment === ".." ||
      /[/\\]/.test(segment)
    ) {
      return { ok: false, reason: "invalid" };
    }
    segments.push(segment);
  }
  const [owner, rawRepo, kind, ...rest] = segments;
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
    return { ok: false, reason: "invalid" };
  }
  if (kind === undefined) return { ok: true, owner, repo, refPath: [] };
  if (kind === "blob") return { ok: false, reason: "file" };
  if (kind !== "tree" || rest.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, owner, repo, refPath: rest };
}

/**
 * Ways to split `/tree/` segments into a branch and a folder, shortest branch
 * first. `main/docs` is branch `main` in folder `docs` far more often than
 * branch `main/docs`, but both are valid Git.
 */
export function githubBranchCandidates(
  refPath: readonly string[],
  limit = 5,
): Array<{ branch: string; path: string }> {
  const candidates: Array<{ branch: string; path: string }> = [];
  for (let split = 1; split <= refPath.length && split <= limit; split++) {
    candidates.push({
      branch: refPath.slice(0, split).join("/"),
      path: refPath.slice(split).join("/"),
    });
  }
  return candidates;
}

export function normalizeGitHubFolderPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

/**
 * The stored identity of a linked folder, also kept on each synced page as
 * its source root. Owners and repositories can't contain `@`, and branch
 * names can't contain `:`, so the parts split back out unambiguously.
 */
export function githubSourceTable(location: GitHubFolderLocation): string {
  return `${location.owner}/${location.repo}@${location.branch}:${normalizeGitHubFolderPath(location.path)}`;
}

export function parseGitHubSourceTable(
  value: string | null | undefined,
): GitHubFolderLocation | null {
  if (!value) return null;
  const match = /^([^/@]+)\/([^/@]+)@([^:]+):(.*)$/.exec(value);
  if (!match) return null;
  const [, owner, repo, branch, path] = match;
  return { owner: owner!, repo: repo!, branch: branch!, path: path! };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function githubFolderWebUrl(location: GitHubFolderLocation): string {
  const base = `https://github.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`;
  const folder = normalizeGitHubFolderPath(location.path);
  return `${base}/tree/${encodePath(location.branch)}${folder ? `/${encodePath(folder)}` : ""}`;
}

export function githubFileWebUrl(
  location: GitHubFolderLocation,
  repoPath: string,
): string {
  return `https://github.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/blob/${encodePath(location.branch)}/${encodePath(repoPath)}`;
}

export function githubFolderLabel(location: GitHubFolderLocation): string {
  const folder = normalizeGitHubFolderPath(location.path);
  return `${location.owner}/${location.repo}${folder ? `/${folder}` : ""}`;
}

/** Joins a folder-relative path back onto the folder for its repository path. */
export function githubRepoPath(folder: string, relativePath: string): string {
  const base = normalizeGitHubFolderPath(folder);
  return base ? `${base}/${relativePath}` : relativePath;
}

export type GitHubSourceSkipReason = "mdx" | "too-large" | "not-text";

/**
 * What went wrong reading a linked folder, in terms a status line can explain
 * and fix: reconnect, regain access, restore the branch or folder, or wait.
 */
export type GitHubSourceProblemCode =
  | "connection"
  | "forbidden"
  | "repository_not_found"
  | "branch_not_found"
  | "folder_not_found"
  | "rate_limited"
  | "too_large"
  | "unavailable"
  | "storage_unavailable";

export type GitHubSourceFileClass =
  | { kind: "markdown" }
  | { kind: "skipped"; reason: GitHubSourceSkipReason }
  | { kind: "ignored" };

const IGNORED_SEGMENTS = new Set(["node_modules"]);

/**
 * Decides what a file in the linked folder becomes. Markdown files are rows;
 * MDX is skipped with its reason until components can be kept as locked
 * blocks; hidden folders and everything else are not pages (images are read
 * when a page references them).
 */
export function classifyGitHubSourceFile(
  relativePath: string,
  size: number | null,
): GitHubSourceFileClass {
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) => segment.startsWith(".") || IGNORED_SEGMENTS.has(segment),
    )
  ) {
    return { kind: "ignored" };
  }
  const name = segments[segments.length - 1]?.toLowerCase() ?? "";
  if (name.endsWith(".mdx")) return { kind: "skipped", reason: "mdx" };
  if (!name.endsWith(".md") && !name.endsWith(".markdown")) {
    return { kind: "ignored" };
  }
  if (size !== null && size > GITHUB_SOURCE_MAX_MARKDOWN_BYTES) {
    return { kind: "skipped", reason: "too-large" };
  }
  return { kind: "markdown" };
}

export type GitHubFieldType = Extract<
  DocumentPropertyType,
  "text" | "number" | "checkbox" | "date" | "url" | "select" | "multi_select"
>;

/** What a folder would become if linked, from a dry run of the link. */
export interface GitHubFolderPreview {
  location: GitHubFolderLocation;
  label: string;
  folderUrl: string;
  commitSha: string;
  markdownFiles: number;
  skipped: Array<{ path: string; reason: GitHubSourceSkipReason }>;
  /** Columns the frontmatter would become, with the type each would get. */
  fields: Array<{ key: string; type: GitHubFieldType; examples: string[] }>;
  sample: Array<{ path: string; title: string }>;
  /** How many files the field types were read from. */
  sampledFiles: number;
  /** Image files in the folder, which pages show from Content's file storage. */
  images: number;
  /** Whether file storage is set up to hold those images. */
  storageReady: boolean;
}

/** Why a collection can't be linked: it has pages, a source, or a system role. */
export type GitHubLinkBlockedReason =
  | "collection-has-rows"
  | "already-linked"
  | "system-collection";

const SELECT_KEY_RE =
  /^(status|state|stage|category|type|kind|section|level|priority|visibility|difficulty|audience)$/i;
const DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const URL_RE = /^https?:\/\/\S+$/i;

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isDateString(value: unknown): boolean {
  return (
    typeof value === "string" &&
    DATE_RE.test(value.trim()) &&
    !Number.isNaN(Date.parse(value.trim()))
  );
}

/**
 * Picks a column type for a frontmatter key from the values seen for it.
 * Lists of strings become multi-select (a lone string among them is a
 * one-item list); booleans, numbers, ISO dates and URLs keep their kind;
 * short labels under keys like `status` become a select; anything else,
 * including mixed kinds and nested objects, is text.
 */
export function inferGitHubFieldType(
  key: string,
  values: readonly unknown[],
): GitHubFieldType {
  const present = values.filter(
    (value) => value !== null && value !== undefined && value !== "",
  );
  if (present.length === 0) return "text";
  if (
    present.some(isStringList) &&
    present.every((value) => isStringList(value) || typeof value === "string")
  ) {
    return "multi_select";
  }
  if (present.every((value) => typeof value === "boolean")) return "checkbox";
  if (
    present.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return "number";
  }
  if (present.every(isDateString)) return "date";
  if (
    present.every((value) => typeof value === "string" && URL_RE.test(value))
  ) {
    return "url";
  }
  if (
    SELECT_KEY_RE.test(key) &&
    present.every(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 100 &&
        !value.includes("\n"),
    )
  ) {
    return "select";
  }
  return "text";
}

/** Whether a frontmatter value can be stored in a column of this type unchanged. */
export function fitsGitHubFieldType(
  type: GitHubFieldType,
  value: unknown,
): boolean {
  if (value === null || value === undefined || value === "") return true;
  switch (type) {
    case "text":
      return true;
    case "checkbox":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "date":
      return isDateString(value);
    case "url":
      return typeof value === "string" && URL_RE.test(value);
    case "select":
      return (
        typeof value === "string" &&
        value.length <= 100 &&
        !value.includes("\n")
      );
    case "multi_select":
      return isStringList(value) || typeof value === "string";
  }
}

/**
 * The value handed to Content's property normalizer for a column of this
 * type: lists stay lists, a lone tag becomes a one-item list, and nested
 * values in a text column are kept as JSON.
 */
export function githubFieldPropertyInput(
  type: GitHubFieldType,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return null;
  if (type === "multi_select") {
    return typeof value === "string" ? [value] : value;
  }
  if (type === "text" && typeof value !== "string") {
    return typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  }
  return value;
}
