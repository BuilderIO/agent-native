import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface CodeAgentWorktreeResult {
  sourcePath: string;
  path: string;
  branch: string;
  baseCommit: string;
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

export type { RunGit };
