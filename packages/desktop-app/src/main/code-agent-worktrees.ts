import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface CodeAgentWorktreeResult {
  sourcePath: string;
  path: string;
  branch: string;
  baseCommit: string;
}

export interface CodeAgentWorktreeCleanupResult {
  branchRemoved: boolean;
  worktreeRemoved: boolean;
}

interface GitResult {
  error?: Error;
  status: number | null;
  stderr?: string;
  stdout?: string;
}

type RunGit = (args: string[], cwd: string) => GitResult;

const runGit: RunGit = (args, cwd) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr ?? undefined,
    stdout: result.stdout ?? undefined,
  };
};

function gitFailure(result: GitResult, fallback: string): Error {
  const detail = result.stderr?.trim() || result.error?.message;
  return new Error(detail ? `${fallback} ${detail}` : fallback);
}

function worktreeSlug(runId: string): string {
  const normalized = runId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(-72) || "session";
}

export function createCodeAgentWorktree(input: {
  sourcePath: string;
  worktreeRoot: string;
  runId: string;
  runGit?: RunGit;
}): CodeAgentWorktreeResult {
  const executeGit = input.runGit ?? runGit;
  const sourceCandidate = path.resolve(input.sourcePath);
  const root = path.resolve(input.worktreeRoot);
  const repository = executeGit(
    ["rev-parse", "--show-toplevel"],
    sourceCandidate,
  );
  if (repository.status !== 0 || !repository.stdout?.trim()) {
    throw gitFailure(
      repository,
      "Selected folder is not a Git repository. Choose a Git folder to use a worktree.",
    );
  }

  const sourcePath = path.resolve(repository.stdout.trim());
  const head = executeGit(["rev-parse", "HEAD"], sourcePath);
  if (head.status !== 0 || !head.stdout?.trim()) {
    throw gitFailure(
      head,
      "Could not determine the Git commit for this worktree.",
    );
  }

  const slug = worktreeSlug(input.runId);
  const branch = `agent-native/${slug}`;
  const worktreePath = path.join(root, slug);
  fs.mkdirSync(root, { recursive: true });

  const created = executeGit(
    ["worktree", "add", "-b", branch, worktreePath, head.stdout.trim()],
    sourcePath,
  );
  if (created.status !== 0) {
    throw gitFailure(created, "Could not create the isolated Git worktree.");
  }

  return {
    sourcePath,
    path: worktreePath,
    branch,
    baseCommit: head.stdout.trim(),
  };
}

/** Remove a generated worktree and its agent-owned branch after a terminal run. */
export function cleanupCodeAgentWorktree(input: {
  sourcePath: string;
  path: string;
  branch: string;
  runGit?: RunGit;
}): CodeAgentWorktreeCleanupResult {
  const executeGit = input.runGit ?? runGit;
  const sourcePath = path.resolve(input.sourcePath);
  const worktreePath = path.resolve(input.path);
  const branchPrefix = "agent-native/";
  const branchSlug = input.branch.startsWith(branchPrefix)
    ? input.branch.slice(branchPrefix.length)
    : "";
  if (!branchSlug || path.basename(worktreePath) !== branchSlug) {
    throw new Error("Refusing to clean up an unmanaged Code Agent worktree.");
  }
  if (worktreePath === sourcePath) {
    throw new Error("Refusing to clean up the source repository.");
  }

  const worktreeRemoved = !fs.existsSync(worktreePath)
    ? true
    : executeGit(
        ["worktree", "remove", "--force", "--", worktreePath],
        sourcePath,
      ).status === 0;
  const branchRef = executeGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`],
    sourcePath,
  );
  const branchRemoved =
    branchRef.status === 1
      ? true
      : branchRef.status === 0 &&
        executeGit(["branch", "-D", "--", input.branch], sourcePath).status ===
          0;
  return { branchRemoved, worktreeRemoved };
}

export type { RunGit };
