import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

function normalizedWorktreeName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

function worktreeNameIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase();
}

function worktreeNameFilesystemSlug(value: string): string {
  const identity = worktreeNameIdentity(value);
  if (identity.length <= 56) return identity;
  const suffix = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 8);
  return `${identity.slice(0, 47)}-${suffix}`;
}

export function normalizeCodeAgentWorktreeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.normalize("NFKC").trim();
  if (
    !trimmed ||
    trimmed.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    return null;
  }
  const slug = normalizedWorktreeName(trimmed);
  return slug ? trimmed : null;
}

export function codeAgentWorktreeNameKey(value: unknown): string | null {
  const normalized = normalizeCodeAgentWorktreeName(value);
  return normalized ? worktreeNameIdentity(normalized) : null;
}

function repositoryRoot(
  sourcePath: string,
  executeGit: RunGit,
): { sourcePath: string; baseCommit: string } {
  const sourceCandidate = path.resolve(sourcePath);
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
  const resolvedSourcePath = path.resolve(repository.stdout.trim());
  const head = executeGit(["rev-parse", "HEAD"], resolvedSourcePath);
  if (head.status !== 0 || !head.stdout?.trim()) {
    throw gitFailure(
      head,
      "Could not determine the Git commit for this worktree.",
    );
  }
  return {
    sourcePath: resolvedSourcePath,
    baseCommit: head.stdout.trim(),
  };
}

export function resolveCodeAgentRepositoryRoot(input: {
  sourcePath: string;
  runGit?: RunGit;
}): string {
  return repositoryRoot(input.sourcePath, input.runGit ?? runGit).sourcePath;
}

function comparablePath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function repositoryNamespace(sourcePath: string): string {
  return createHash("sha256")
    .update(comparablePath(sourcePath))
    .digest("hex")
    .slice(0, 12);
}

export function assertManagedCodeAgentWorktree(input: {
  sourcePath: string;
  path: string;
  branch: string;
  runGit?: RunGit;
}): void {
  const executeGit = input.runGit ?? runGit;
  const source = repositoryRoot(input.sourcePath, executeGit);
  const worktreePath = path.resolve(input.path);
  const worktreeRoot = executeGit(
    ["rev-parse", "--show-toplevel"],
    worktreePath,
  );
  if (worktreeRoot.status !== 0 || !worktreeRoot.stdout?.trim()) {
    throw gitFailure(
      worktreeRoot,
      "The managed worktree path is not a Git worktree.",
    );
  }
  if (
    comparablePath(worktreeRoot.stdout.trim()) !== comparablePath(worktreePath)
  ) {
    throw new Error("The managed worktree path resolves to another folder.");
  }

  const worktreeBranch = executeGit(["branch", "--show-current"], worktreePath);
  if (
    worktreeBranch.status !== 0 ||
    worktreeBranch.stdout?.trim() !== input.branch
  ) {
    throw new Error("The managed worktree is on an unexpected branch.");
  }

  const sourceGitDirectory = executeGit(
    ["rev-parse", "--git-common-dir"],
    source.sourcePath,
  );
  const worktreeGitDirectory = executeGit(
    ["rev-parse", "--git-common-dir"],
    worktreePath,
  );
  if (
    sourceGitDirectory.status !== 0 ||
    worktreeGitDirectory.status !== 0 ||
    !sourceGitDirectory.stdout?.trim() ||
    !worktreeGitDirectory.stdout?.trim() ||
    comparablePath(
      path.resolve(source.sourcePath, sourceGitDirectory.stdout.trim()),
    ) !==
      comparablePath(
        path.resolve(worktreePath, worktreeGitDirectory.stdout.trim()),
      )
  ) {
    throw new Error("The managed worktree belongs to another repository.");
  }
}

export function createNamedCodeAgentWorktree(input: {
  sourcePath: string;
  worktreeRoot: string;
  name: string;
  runGit?: RunGit;
}): CodeAgentWorktreeResult & { name: string } {
  const executeGit = input.runGit ?? runGit;
  const name = normalizeCodeAgentWorktreeName(input.name);
  if (!name) {
    throw new Error(
      "Worktree names must be 1-64 characters and cannot contain control characters.",
    );
  }
  const repository = repositoryRoot(input.sourcePath, executeGit);
  const slug = worktreeNameFilesystemSlug(name);
  const namespace = repositoryNamespace(repository.sourcePath);
  const worktreePath = path.join(
    path.resolve(input.worktreeRoot),
    `named-${namespace}-${slug}`,
  );
  const branch = `agent-native/named-${namespace}-${slug}`;
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const created = executeGit(
    ["worktree", "add", "-b", branch, worktreePath, repository.baseCommit],
    repository.sourcePath,
  );
  if (created.status !== 0) {
    throw gitFailure(created, "Could not create the named Git worktree.");
  }
  return {
    ...repository,
    path: worktreePath,
    branch,
    name,
  };
}

export function restoreCodeAgentWorktree(input: {
  sourcePath: string;
  path: string;
  branch: string;
  baseCommit: string;
  runGit?: RunGit;
}): CodeAgentWorktreeResult {
  const executeGit = input.runGit ?? runGit;
  const repository = repositoryRoot(input.sourcePath, executeGit);
  const worktreePath = path.resolve(input.path);
  const root = path.resolve(path.dirname(worktreePath));
  if (worktreePath === repository.sourcePath) {
    throw new Error("Refusing to restore the source repository as a worktree.");
  }
  if (!input.branch.startsWith("agent-native/")) {
    throw new Error("Refusing to restore an unmanaged Code Agent worktree.");
  }
  if (fs.existsSync(worktreePath)) {
    throw new Error("The worktree path is already occupied.");
  }
  fs.mkdirSync(root, { recursive: true });
  const branchRef = executeGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`],
    repository.sourcePath,
  );
  const created =
    branchRef.status === 0
      ? executeGit(
          ["worktree", "add", "--force", worktreePath, input.branch],
          repository.sourcePath,
        )
      : executeGit(
          [
            "worktree",
            "add",
            "--force",
            "-b",
            input.branch,
            worktreePath,
            input.baseCommit,
          ],
          repository.sourcePath,
        );
  if (created.status !== 0) {
    throw gitFailure(created, "Could not restore the Code Agent worktree.");
  }
  return {
    sourcePath: repository.sourcePath,
    path: worktreePath,
    branch: input.branch,
    baseCommit: input.baseCommit,
  };
}

export function codeAgentWorktreeHasChanges(input: {
  path: string;
  runGit?: RunGit;
}): boolean {
  const executeGit = input.runGit ?? runGit;
  const result = executeGit(
    ["status", "--porcelain", "--untracked-files=all"],
    path.resolve(input.path),
  );
  if (result.status !== 0) {
    throw gitFailure(result, "Could not inspect the Code Agent worktree.");
  }
  return Boolean(result.stdout?.trim());
}

export function codeAgentWorktreeHasCommitsAfterBase(input: {
  sourcePath: string;
  branch: string;
  baseCommit: string;
  runGit?: RunGit;
}): boolean {
  const executeGit = input.runGit ?? runGit;
  const result = executeGit(
    ["rev-list", "--count", `${input.baseCommit}..${input.branch}`],
    path.resolve(input.sourcePath),
  );
  if (result.status !== 0) {
    throw gitFailure(
      result,
      "Could not inspect commits in the Code Agent worktree.",
    );
  }
  const count = Number(result.stdout?.trim());
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      "Git returned an invalid Code Agent worktree commit count.",
    );
  }
  return count > 0;
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
