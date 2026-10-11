import { fail } from "@agent-native/core/action";
import { z } from "zod";

import type { GitHubFolderLink } from "../../../shared/dashboard-github-sync";
import type { CredentialContext } from "../credentials";
import { getGitHubAccessToken } from "../github-oauth";
import { gitBlobSha } from "./plan";

const GITHUB_API_BASE = "https://api.github.com";
const MISSING_CONNECTION_MESSAGE =
  "GitHub is not connected. Connect GitHub under Settings before syncing this folder.";
// GitHub drops directory entries past 1000 without an error, so a listing that
// size may be truncated and cannot be trusted.
const MAX_LISTING_ENTRIES = 1000;
const MAX_ERROR_DETAIL_CHARS = 300;

// These failures reach the dialog verbatim, so they use fail() with a code.
// A bare Error comes back as "Internal server error".

const listingSchema = z.array(
  z.object({
    type: z.string(),
    name: z.string(),
    path: z.string(),
    sha: z.string(),
  }),
);
const fileSchema = z.object({
  type: z.literal("file"),
  encoding: z.literal("base64"),
  content: z.string(),
  sha: z.string(),
});
const refSchema = z.object({
  ref: z.string(),
  object: z.object({ sha: z.string() }),
});
const commitSchema = z.object({
  sha: z.string(),
  tree: z.object({ sha: z.string() }),
});
const shaSchema = z.object({ sha: z.string() });
const pullSchema = z.object({
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
});
const createdPullSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
});

async function gitHubToken(ctx: CredentialContext): Promise<string> {
  const { token } = await getGitHubAccessToken(ctx);
  if (!token) {
    fail(MISSING_CONNECTION_MESSAGE, {
      errorCode: "github_not_connected",
      statusCode: 412,
    });
  }
  return token;
}

function gitHubHeaders(
  token: string,
  hasBody: boolean,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

function repoUrl(owner: string, repo: string): string {
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function contentsUrl(link: GitHubFolderLink, path: string): string {
  const query = new URLSearchParams({ ref: link.branch }).toString();
  return `${repoUrl(link.owner, link.repo)}/contents/${encodePathSegments(path)}?${query}`;
}

async function throwGitHubFailure(step: string, res: Response): Promise<never> {
  const detail = (await res.text()).slice(0, MAX_ERROR_DETAIL_CHARS);
  fail(
    `GitHub ${step} failed: HTTP ${res.status}${detail ? ` ${detail}` : ""}`,
    {
      errorCode: "github_request_failed",
      statusCode: 502,
    },
  );
}

async function readGitHubJson<T>(
  step: string,
  res: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    fail(
      `GitHub ${step} returned a body that is not JSON: ${err instanceof Error ? err.message : String(err)}`,
      { errorCode: "github_unexpected_response", statusCode: 502 },
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    fail(
      `GitHub ${step} returned an unexpected response: ${parsed.error.message}`,
      { errorCode: "github_unexpected_response", statusCode: 502 },
    );
  }
  return parsed.data;
}

async function gitHubCall<T>(
  token: string,
  step: string,
  method: "GET" | "POST",
  url: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: gitHubHeaders(token, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return throwGitHubFailure(step, res);
  return readGitHubJson(step, res, schema);
}

/** A folder that does not exist in GitHub yet lists as empty. */
export async function listGitHubFolderFiles(
  ctx: CredentialContext,
  link: GitHubFolderLink,
): Promise<Array<{ path: string; sha: string }>> {
  const token = await gitHubToken(ctx);
  const res = await fetch(contentsUrl(link, link.path), {
    headers: gitHubHeaders(token, false),
  });
  if (res.status === 404) return [];
  if (!res.ok) return throwGitHubFailure("folder listing", res);
  const entries = await readGitHubJson("folder listing", res, listingSchema);
  if (entries.length >= MAX_LISTING_ENTRIES) {
    fail(
      `GitHub folder "${link.path}" has ${entries.length} entries. A listing this large may be truncated, so the folder cannot be synced safely.`,
      { errorCode: "github_listing_too_large", statusCode: 422 },
    );
  }
  return entries
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".json"))
    .map((entry) => ({ path: entry.path, sha: entry.sha }));
}

/** Fails when the branch does not exist, so a typo does not look like an empty folder. */
export async function assertGitHubBranch(
  ctx: CredentialContext,
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  const token = await gitHubToken(ctx);
  const res = await fetch(
    `${repoUrl(owner, repo)}/git/ref/heads/${encodePathSegments(branch)}`,
    { headers: gitHubHeaders(token, false) },
  );
  if (res.status === 404) {
    fail(
      `GitHub branch "${branch}" was not found in ${owner}/${repo}. Check the branch name and that the repository is accessible.`,
      { errorCode: "github_branch_not_found", statusCode: 404 },
    );
  }
  if (!res.ok) {
    return throwGitHubFailure(`branch lookup for "${branch}"`, res);
  }
  await readGitHubJson(`branch lookup for "${branch}"`, res, refSchema);
}

export async function readGitHubFile(
  ctx: CredentialContext,
  link: GitHubFolderLink,
  path: string,
): Promise<{ sha: string; content: string }> {
  const token = await gitHubToken(ctx);
  const file = await gitHubCall(
    token,
    `read "${path}"`,
    "GET",
    contentsUrl(link, path),
    fileSchema,
  );
  const content = Buffer.from(file.content, "base64").toString("utf8");
  // Node's base64 decoder skips invalid characters and utf8 decoding replaces
  // invalid bytes, so bytes that differ from the file come out silently. The
  // blob sha is the check that catches both.
  if (gitBlobSha(content) !== file.sha) {
    fail(
      `GitHub returned content for "${path}" that does not match its blob sha.`,
      { errorCode: "github_content_mismatch", statusCode: 502 },
    );
  }
  return { sha: file.sha, content };
}

export async function getGitHubPullRequestState(
  ctx: CredentialContext,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<"open" | "merged" | "closed"> {
  const token = await gitHubToken(ctx);
  const pr = await gitHubCall(
    token,
    `pull request #${prNumber} lookup`,
    "GET",
    `${repoUrl(owner, repo)}/pulls/${prNumber}`,
    pullSchema,
  );
  if (pr.state === "open") return "open";
  return pr.merged ? "merged" : "closed";
}

/**
 * Commits every file on one new branch on top of the link branch and opens a
 * PR. Each step is a separate call so a failure names the step; a failed run
 * leaves at most an unreferenced blob or tree, and a retry re-plans from DB state.
 */
export async function createGitHubExportPullRequest(
  ctx: CredentialContext,
  input: {
    link: GitHubFolderLink;
    branch: string;
    title: string;
    body: string;
    commitMessage: string;
    files: Array<{ path: string; content: string }>;
  },
): Promise<{
  prNumber: number;
  prUrl: string;
  blobShas: Record<string, string>;
}> {
  if (input.files.length === 0) {
    throw new Error("GitHub export has no files to commit");
  }
  const token = await gitHubToken(ctx);
  const api = repoUrl(input.link.owner, input.link.repo);

  const base = await gitHubCall(
    token,
    "read base branch",
    "GET",
    `${api}/git/ref/heads/${encodePathSegments(input.link.branch)}`,
    refSchema,
  );
  const baseCommitSha = base.object.sha;
  const baseCommit = await gitHubCall(
    token,
    "read base commit",
    "GET",
    `${api}/git/commits/${baseCommitSha}`,
    commitSchema,
  );

  const blobShas: Record<string, string> = {};
  const treeEntries: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string;
  }> = [];
  for (const file of input.files) {
    const blob = await gitHubCall(
      token,
      "create blob",
      "POST",
      `${api}/git/blobs`,
      shaSchema,
      { content: file.content, encoding: "utf-8" },
    );
    const expected = gitBlobSha(file.content);
    if (blob.sha !== expected) {
      fail(
        `GitHub stored "${file.path}" as ${blob.sha}, but its content hashes to ${expected}.`,
        { errorCode: "github_blob_mismatch", statusCode: 502 },
      );
    }
    blobShas[file.path] = blob.sha;
    treeEntries.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await gitHubCall(
    token,
    "create tree",
    "POST",
    `${api}/git/trees`,
    shaSchema,
    { base_tree: baseCommit.tree.sha, tree: treeEntries },
  );
  const commit = await gitHubCall(
    token,
    "create commit",
    "POST",
    `${api}/git/commits`,
    shaSchema,
    {
      message: input.commitMessage,
      tree: tree.sha,
      parents: [baseCommitSha],
    },
  );
  await gitHubCall(
    token,
    "create branch",
    "POST",
    `${api}/git/refs`,
    refSchema,
    { ref: `refs/heads/${input.branch}`, sha: commit.sha },
  );
  const pr = await gitHubCall(
    token,
    "open pull request",
    "POST",
    `${api}/pulls`,
    createdPullSchema,
    {
      title: input.title,
      body: input.body,
      head: input.branch,
      base: input.link.branch,
    },
  );
  return { prNumber: pr.number, prUrl: pr.html_url, blobShas };
}
