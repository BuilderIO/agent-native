import type { GitHubSourceProblemCode } from "../../shared/github-source.js";
import { executeGitHubSourceRequest } from "./provider-api.js";

export type { GitHubSourceProblemCode };

export class GitHubSourceError extends Error {
  constructor(
    readonly code: GitHubSourceProblemCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubSourceError";
  }
}

/**
 * A request the caller's time budget cut short. Nothing is wrong with the
 * link, so a sync stops where it is instead of recording a problem.
 */
export class GitHubSourceDeadlineError extends Error {
  constructor() {
    super("GitHub didn't answer before the sync's time ran out.");
    this.name = "GitHubSourceDeadlineError";
  }
}

export interface GitHubRepositoryTarget {
  owner: string;
  repo: string;
  connectionId?: string | null;
  /** Ends the request when the caller's time budget runs out. */
  signal?: AbortSignal;
}

export interface GitHubTreeEntry {
  /** Path relative to the folder the tree was read for. */
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size: number | null;
}

interface ProviderResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  json?: unknown;
  text?: string;
  truncated: boolean;
}

const TREE_MAX_BYTES = 4 * 1024 * 1024;
const BLOB_MAX_BYTES = 4 * 1024 * 1024;
const COMPARE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Encodes a branch or folder for an API path. Git allows no empty or dot
 * segments, and URL resolution would turn `..` into a request for another
 * endpoint, so they're refused rather than sent.
 */
function encodePath(
  path: string,
  code: "branch_not_found" | "folder_not_found",
): string {
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) {
    throw new GitHubSourceError(
      code,
      code === "branch_not_found"
        ? `"${path}" isn't a branch name GitHub allows.`
        : `"${path}" isn't a folder path GitHub allows.`,
    );
  }
  return segments.map(encodeURIComponent).join("/");
}

function repoPath(target: GitHubRepositoryTarget): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function header(response: ProviderResponse, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/**
 * Settles as the request does, or fails once the caller's time runs out. It
 * listens to the request either way, so one it stops waiting for can't fail
 * unheard.
 */
function untilDeadline<T>(
  request: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new GitHubSourceDeadlineError());
    request
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** How long the provider client gives a request before it ends it itself. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How the provider client reports a request that a signal ended. */
function endedBySignal(error: unknown): boolean {
  const cause =
    error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  return (
    !!cause &&
    typeof cause === "object" &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

async function githubGet(
  target: GitHubRepositoryTarget,
  path: string,
  options: { etag?: string | null; maxBytes?: number } = {},
): Promise<ProviderResponse> {
  // The provider client can hold a request past this signal: it waits its
  // turn under GitHub's rate limits, and identical reads in flight share one
  // request, which the first caller's signal ends. So this read stops waiting
  // at its own deadline, and while it has time left, or has no deadline, asks
  // once more when some other signal ended it, such as another caller's on a
  // read they shared, like a link preview's read shared with a sync. If
  // that ends too, GitHub didn't answer in time, the same as at its own
  // deadline, rather than something wrong with the link. The client ends a
  // request at its own timeout the same way, so a try that lasted that long
  // isn't sent again.
  const send = () => {
    const request = executeGitHubSourceRequest({
      provider: "github",
      method: "GET",
      path,
      headers: options.etag ? { "If-None-Match": options.etag } : undefined,
      connectionId: target.connectionId ?? undefined,
      maxBytes: options.maxBytes,
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal: target.signal,
    });
    return target.signal ? untilDeadline(request, target.signal) : request;
  };
  const started = Date.now();
  let raw: unknown;
  try {
    raw = await send().catch((error: unknown) => {
      const endedElsewhere =
        endedBySignal(error) && Date.now() - started < REQUEST_TIMEOUT_MS;
      if (!target.signal?.aborted && endedElsewhere) return send();
      throw error;
    });
  } catch (error) {
    if (target.signal && (target.signal.aborted || endedBySignal(error))) {
      throw new GitHubSourceDeadlineError();
    }
    throw error;
  }
  const result = asRecord(raw);
  const response = asRecord(result.response) as unknown as ProviderResponse;
  if (typeof response.status !== "number") {
    throw new GitHubSourceError("unavailable", "GitHub returned no response.");
  }
  if (response.status === 304) return response;
  if (response.truncated) {
    throw new GitHubSourceError(
      "too_large",
      "GitHub's response was too large to read in one request.",
      response.status,
    );
  }
  if (response.ok) return response;
  throw responseError(response);
}

function responseError(response: ProviderResponse): GitHubSourceError {
  const message =
    typeof asRecord(response.json).message === "string"
      ? (asRecord(response.json).message as string)
      : `HTTP ${response.status}`;
  if (response.status === 401) {
    return new GitHubSourceError(
      "connection",
      "GitHub no longer accepts the saved connection. Reconnect GitHub.",
      401,
    );
  }
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (header(response, "x-ratelimit-remaining") === "0" ||
        /rate limit/i.test(message)))
  ) {
    const reset = Number(header(response, "x-ratelimit-reset"));
    const at =
      Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null;
    return new GitHubSourceError(
      "rate_limited",
      at
        ? `GitHub's rate limit is used up until ${at.toISOString()}.`
        : "GitHub's rate limit is used up for now.",
      response.status,
    );
  }
  if (response.status === 403) {
    return new GitHubSourceError(
      "forbidden",
      `GitHub refused access: ${message}`,
      403,
    );
  }
  if (response.status === 404) {
    return new GitHubSourceError("repository_not_found", message, 404);
  }
  return new GitHubSourceError(
    "unavailable",
    `GitHub returned ${response.status}: ${message}`,
    response.status,
  );
}

/**
 * A 404 from GitHub means the thing is missing or the token can't see it.
 * Asking for the repository itself tells a lost repository apart from a
 * missing branch or folder inside one that's still there.
 */
async function refineNotFound(
  target: GitHubRepositoryTarget,
  error: unknown,
  inside: "branch_not_found" | "folder_not_found",
  message: string,
): Promise<never> {
  if (
    !(error instanceof GitHubSourceError) ||
    error.code !== "repository_not_found"
  ) {
    throw error;
  }
  try {
    await githubGet(target, repoPath(target));
  } catch (repoError) {
    if (
      repoError instanceof GitHubSourceError &&
      repoError.code === "repository_not_found"
    ) {
      throw new GitHubSourceError(
        "repository_not_found",
        `GitHub can't find ${target.owner}/${target.repo}, or the connected account can't see it.`,
        404,
      );
    }
    throw repoError;
  }
  throw new GitHubSourceError(inside, message, 404);
}

/** The branch a repository URL without `/tree/` means. */
export async function readGitHubDefaultBranch(
  target: GitHubRepositoryTarget,
): Promise<string> {
  let response: ProviderResponse;
  try {
    response = await githubGet(target, repoPath(target));
  } catch (error) {
    if (
      error instanceof GitHubSourceError &&
      error.code === "repository_not_found"
    ) {
      throw new GitHubSourceError(
        "repository_not_found",
        `GitHub can't find ${target.owner}/${target.repo}, or the connected account can't see it.`,
        404,
      );
    }
    throw error;
  }
  const branch = asRecord(response.json).default_branch;
  if (typeof branch !== "string" || !branch) {
    throw new GitHubSourceError(
      "branch_not_found",
      `${target.owner}/${target.repo} has no default branch yet.`,
    );
  }
  return branch;
}

export type GitHubBranchHead =
  | { status: "not-modified" }
  | { status: "ok"; sha: string; etag: string | null };

/**
 * Reads the commit a branch points at. With the ETag from the last read,
 * an unchanged branch answers 304, which GitHub doesn't count against the
 * rate limit.
 */
export async function readGitHubBranchHead(
  target: GitHubRepositoryTarget & { branch: string },
  etag?: string | null,
): Promise<GitHubBranchHead> {
  const branchPath = encodePath(target.branch, "branch_not_found");
  let response: ProviderResponse;
  try {
    response = await githubGet(
      target,
      `${repoPath(target)}/git/ref/heads/${branchPath}`,
      { etag },
    );
  } catch (error) {
    return refineNotFound(
      target,
      error,
      "branch_not_found",
      `The branch "${target.branch}" doesn't exist in ${target.owner}/${target.repo}.`,
    );
  }
  if (response.status === 304) return { status: "not-modified" };
  const object = asRecord(asRecord(response.json).object);
  if (typeof object.sha !== "string") {
    throw new GitHubSourceError(
      "branch_not_found",
      `"${target.branch}" in ${target.owner}/${target.repo} is not a branch.`,
    );
  }
  return { status: "ok", sha: object.sha, etag: header(response, "etag") };
}

/** Lists every file under a folder at one commit, in one request. */
export async function readGitHubFolderTree(
  target: GitHubRepositoryTarget & { commitSha: string; path: string },
): Promise<GitHubTreeEntry[]> {
  const treeish = target.path
    ? `${target.commitSha}:${target.path}`
    : target.commitSha;
  const treePath = encodePath(treeish, "folder_not_found");
  let response: ProviderResponse;
  try {
    response = await githubGet(
      target,
      `${repoPath(target)}/git/trees/${treePath}?recursive=1`,
      { maxBytes: TREE_MAX_BYTES },
    );
  } catch (error) {
    return refineNotFound(
      target,
      error,
      "folder_not_found",
      `The folder "${target.path}" doesn't exist on this branch.`,
    );
  }
  const body = asRecord(response.json);
  if (body.truncated === true) {
    throw new GitHubSourceError(
      "too_large",
      "This folder has more files than GitHub lists in one tree. Link a smaller folder.",
    );
  }
  // Read as an empty folder, a listing without its entries would move every
  // page to Trash, so it fails the sync instead.
  if (!Array.isArray(body.tree)) {
    throw new GitHubSourceError(
      "unavailable",
      "GitHub returned a folder listing without its files.",
      response.status,
    );
  }
  const entries: GitHubTreeEntry[] = [];
  for (const raw of body.tree) {
    const entry = asRecord(raw);
    if (
      typeof entry.path !== "string" ||
      typeof entry.sha !== "string" ||
      (entry.type !== "blob" &&
        entry.type !== "tree" &&
        entry.type !== "commit")
    ) {
      continue;
    }
    entries.push({
      path: entry.path,
      type: entry.type,
      sha: entry.sha,
      size: typeof entry.size === "number" ? entry.size : null,
    });
  }
  return entries;
}

/** Reads one file's bytes by blob SHA, which never changes for the same content. */
export async function readGitHubBlob(
  target: GitHubRepositoryTarget & { sha: string },
): Promise<Uint8Array> {
  const response = await githubGet(
    target,
    `${repoPath(target)}/git/blobs/${encodeURIComponent(target.sha)}`,
    { maxBytes: BLOB_MAX_BYTES },
  );
  const body = asRecord(response.json);
  if (typeof body.content !== "string" || body.encoding !== "base64") {
    throw new GitHubSourceError(
      "unavailable",
      "GitHub returned a file in an unexpected encoding.",
    );
  }
  return new Uint8Array(Buffer.from(body.content, "base64"));
}

/**
 * Files Git saw renamed between two commits, as repository paths. GitHub
 * lists a comparison's changed files, up to 300, on its first page only;
 * `per_page` pages the commits, so one commit keeps the response small.
 * Best effort: a comparison too large to read, or one naming a commit
 * GitHub no longer has (after a force-push), returns null, and the caller
 * falls back to matching identical files and frontmatter ids. Any other
 * failure fails the sync, which tries again rather than lose a rename.
 */
export async function readGitHubRenames(
  target: GitHubRepositoryTarget & { base: string; head: string },
): Promise<Array<{ from: string; to: string }> | null> {
  try {
    const response = await githubGet(
      target,
      `${repoPath(target)}/compare/${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}?per_page=1`,
      { maxBytes: COMPARE_MAX_BYTES },
    );
    const files = asRecord(response.json).files;
    if (!Array.isArray(files)) return null;
    return files.flatMap((raw) => {
      const file = asRecord(raw);
      return file.status === "renamed" &&
        typeof file.filename === "string" &&
        typeof file.previous_filename === "string"
        ? [{ from: file.previous_filename, to: file.filename }]
        : [];
    });
  } catch (error) {
    if (
      error instanceof GitHubSourceError &&
      (error.code === "too_large" ||
        error.status === 404 ||
        error.status === 422)
    ) {
      return null;
    }
    throw error;
  }
}
