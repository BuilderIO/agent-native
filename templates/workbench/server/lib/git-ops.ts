/**
 * Code Room — git helpers wrapping simple-git.
 *
 * All public functions take the absolute `workspaceRoot`. They never
 * exec arbitrary git commands from user input — every call is mapped to
 * a typed simple-git method, so there's no shell injection vector.
 *
 * If the workspace is not a git repo, `getGitStatus` returns a sentinel
 * `{ isRepo: false }` instead of throwing; callers render the
 * "initialize repo" empty state from that.
 */

import simpleGit, { type SimpleGit } from "simple-git";

export interface ChangedFile {
  /** Workspace-relative path with forward slashes. */
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
}

export interface GitStatus {
  isRepo: true;
  branch: string;
  ahead: number;
  behind: number;
  staged: ChangedFile[];
  unstaged: ChangedFile[];
  untracked: string[];
}

export interface NotARepoStatus {
  isRepo: false;
}

export function git(workspaceRoot: string): SimpleGit {
  return simpleGit({ baseDir: workspaceRoot });
}

export async function getGitStatus(
  workspaceRoot: string,
): Promise<GitStatus | NotARepoStatus> {
  const g = git(workspaceRoot);
  let isRepo = false;
  try {
    isRepo = await g.checkIsRepo();
  } catch {
    isRepo = false;
  }
  if (!isRepo) return { isRepo: false };

  const status = await g.status();
  const staged: ChangedFile[] = [];
  const unstaged: ChangedFile[] = [];

  // simple-git's `status.files` enumerates every dirty path with an
  // `index` (staged) char and `working_dir` (unstaged) char. We split
  // each file into staged / unstaged buckets.
  for (const f of status.files) {
    const stagedStatus = parseStatusChar(f.index);
    if (stagedStatus) {
      staged.push({
        path: normalize(f.path),
        status: stagedStatus,
        staged: true,
      });
    }
    const unstagedStatus = parseStatusChar(f.working_dir);
    if (unstagedStatus) {
      unstaged.push({
        path: normalize(f.path),
        status: unstagedStatus,
        staged: false,
      });
    }
  }

  return {
    isRepo: true,
    branch: status.current ?? "(detached)",
    ahead: status.ahead,
    behind: status.behind,
    staged,
    unstaged,
    untracked: status.not_added.map(normalize),
  };
}

export interface FileDiff {
  /** File content as recorded at HEAD (empty for "added"). */
  oldContent: string;
  /** Working-copy content (empty for "deleted"). */
  newContent: string;
  /** Unified diff string suitable for the legacy `<PRDiff>` renderer. */
  unifiedDiff: string;
}

/**
 * Returns the before/after content + a unified diff for one file. The
 * scope flag picks which side of staging we're looking at: `unstaged`
 * compares working tree vs index (default), `staged` compares index vs
 * HEAD, `all` is HEAD vs working tree.
 */
export async function getGitDiffForFile(
  workspaceRoot: string,
  filePath: string,
  options?: { scope?: "unstaged" | "staged" | "all" },
): Promise<FileDiff> {
  const scope = options?.scope ?? "unstaged";
  const g = git(workspaceRoot);

  // Old content: depending on scope, either HEAD or index.
  let oldContent = "";
  try {
    if (scope === "staged") {
      // Index version (what `git diff --cached` compares against HEAD).
      oldContent = await g.show([`HEAD:${filePath}`]);
    } else if (scope === "unstaged") {
      // Working tree differs from index — show the index version as old.
      oldContent = await g.show([`:${filePath}`]);
    } else {
      // `all`: HEAD vs working tree.
      oldContent = await g.show([`HEAD:${filePath}`]);
    }
  } catch {
    // File didn't exist at the comparison base (newly-added file).
    oldContent = "";
  }

  // New content: working tree (we ship file contents instead of
  // re-reading from disk so the caller doesn't need a second action).
  let newContent = "";
  try {
    if (scope === "staged") {
      // Compare HEAD against index — "new" is the index version.
      newContent = await g.show([`:${filePath}`]);
    } else {
      // Working tree path: read via simple-git's raw fs-equivalent
      // (`git show` on a missing tree falls back to disk by raw cat).
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      try {
        newContent = await fs.readFile(
          path.resolve(workspaceRoot, filePath),
          "utf-8",
        );
      } catch {
        newContent = "";
      }
    }
  } catch {
    newContent = "";
  }

  // Unified diff for the legacy `<PRDiff>` renderer path.
  let unifiedDiff = "";
  try {
    if (scope === "staged") {
      unifiedDiff = await g.diff(["--cached", "--", filePath]);
    } else if (scope === "unstaged") {
      unifiedDiff = await g.diff(["--", filePath]);
    } else {
      unifiedDiff = await g.diff(["HEAD", "--", filePath]);
    }
  } catch {
    unifiedDiff = "";
  }

  return { oldContent, newContent, unifiedDiff };
}

/**
 * Stages every dirty path and commits with `message`. Returns the new
 * commit hash. Throws when there's nothing to commit.
 */
export async function commitAllChanges(
  workspaceRoot: string,
  message: string,
): Promise<{ hash: string }> {
  const g = git(workspaceRoot);
  await g.add(["--all"]);
  const result = await g.commit(message);
  if (!result.commit) {
    throw new Error("Nothing to commit (working tree clean).");
  }
  return { hash: result.commit };
}

/**
 * Checkout (or create + checkout) a branch.
 */
export async function checkoutBranch(
  workspaceRoot: string,
  branchName: string,
  options?: { create?: boolean },
): Promise<void> {
  const g = git(workspaceRoot);
  if (options?.create) {
    await g.checkoutLocalBranch(branchName);
  } else {
    await g.checkout(branchName);
  }
}

/**
 * `git push` for the current branch, setting upstream to origin/<branch>
 * if not already set.
 */
export async function pushCurrentBranch(
  workspaceRoot: string,
  branchName: string,
): Promise<void> {
  const g = git(workspaceRoot);
  await g.push(["--set-upstream", "origin", branchName]);
}

/**
 * Read `remote.origin.url` so we can derive an `owner/repo` slug for the
 * GitHub API call that creates the PR.
 */
export async function getOriginOwnerRepo(
  workspaceRoot: string,
): Promise<{ owner: string; repo: string } | null> {
  const g = git(workspaceRoot);
  try {
    const remotes = await g.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin) return null;
    const url = origin.refs.push || origin.refs.fetch;
    return parseGitHubRemote(url);
  } catch {
    return null;
  }
}

/** Parse common GitHub remote URL shapes into `{ owner, repo }`. */
export function parseGitHubRemote(
  url: string | undefined,
): { owner: string; repo: string } | null {
  if (!url) return null;
  // ssh: git@github.com:owner/repo.git
  // https: https://github.com/owner/repo(.git)?
  const sshMatch = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(url);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

function parseStatusChar(c: string): ChangedFile["status"] | null {
  switch (c) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "?":
      return "untracked";
    case " ":
    case "":
      return null;
    default:
      return "modified";
  }
}

function normalize(p: string): string {
  return p.split("\\").join("/");
}
