import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { codeAgentStoreRoot } from "./code-agent-runs.js";

const execFile = promisify(execFileCallback);
const MAX_GIT_OUTPUT_BYTES = 1_000_000;
const PORTAL_ENV_FILES = [".env", ".env.local"] as const;
const PORTAL_PROTECTED_ENV_KEYS = new Set([
  "AGENT_NATIVE_CODE_AGENTS_HOME",
  "AGENT_NATIVE_CODE_AGENT_PERMISSION_MODE",
  "AGENT_NATIVE_COMPUTER_BRIDGE_TOKEN",
  "AGENT_NATIVE_COMPUTER_BRIDGE_URL",
  "AGENT_NATIVE_REMOTE_DEVICE_PATH",
  "ELECTRON_RUN_AS_NODE",
  "HOME",
  "NODE_OPTIONS",
  "PATH",
  "PWD",
  "SHELL",
]);

export interface PortalHandoff {
  schemaVersion: 1;
  handoffId: string;
  branch: string;
  remoteRef: string;
  commit: string;
  sourceBranch?: string;
  sourceDirty: boolean;
  createdCommit: boolean;
  repositoryName: string;
  remoteName: string;
  envPolicy: "load-local";
}

export interface PortalEnvironment {
  values: Record<string, string>;
  files: string[];
  root: string;
}

export interface PortalWorkspace {
  handoff: PortalHandoff;
  repositoryPath: string;
  workspacePath: string;
  environmentRoot: string;
  environmentFiles: string[];
  reused: boolean;
}

export interface PortalGitResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export type RunPortalGit = (
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => PortalGitResult | Promise<PortalGitResult>;

const runPortalGit: RunPortalGit = async (args, cwd, env) => {
  try {
    const result = await execFile("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        ...env,
      },
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return {
      status: 0,
      stdout: String(result.stdout),
      stderr: String(result.stderr),
    };
  } catch (error) {
    const candidate = error as {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      status: typeof candidate.code === "number" ? candidate.code : 1,
      stdout: candidate.stdout ? String(candidate.stdout) : undefined,
      stderr: candidate.stderr ? String(candidate.stderr) : undefined,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

export async function createPortalHandoff(input: {
  sourcePath: string;
  remoteName?: string;
  handoffId?: string;
  now?: Date;
  runGit?: RunPortalGit;
}): Promise<PortalHandoff> {
  const executeGit = input.runGit ?? runPortalGit;
  const sourceCandidate = path.resolve(input.sourcePath);
  const remoteName = input.remoteName ?? "origin";
  assertSafeRemoteName(remoteName);
  const handoffId = input.handoffId ?? crypto.randomUUID();
  assertSafeHandoffId(handoffId);

  const repositoryPath = await requiredGitOutput(
    executeGit,
    ["rev-parse", "--show-toplevel"],
    sourceCandidate,
    "Selected folder is not a Git repository. Choose a Git folder to use Portal.",
  );
  const head = await requiredGitOutput(
    executeGit,
    ["rev-parse", "--verify", "HEAD"],
    repositoryPath,
    "Portal could not determine the current Git commit.",
  );
  const status = await executeGit(
    ["status", "--porcelain", "--untracked-files=all"],
    repositoryPath,
  );
  if (status.status !== 0) {
    throw gitFailure(
      status,
      "Portal could not inspect the local Git working tree.",
    );
  }
  const remoteUrl = await requiredGitOutput(
    executeGit,
    ["remote", "get-url", remoteName],
    repositoryPath,
    `Portal could not find the ${remoteName} Git remote.`,
  );
  if (!remoteUrl) {
    throw new Error(`Portal could not find the ${remoteName} Git remote.`);
  }

  const branchResult = await executeGit(
    ["branch", "--show-current"],
    repositoryPath,
  );
  const sourceBranch =
    branchResult.status === 0
      ? branchResult.stdout?.trim() || undefined
      : undefined;
  const sourceDirty = Boolean(status.stdout?.trim());
  let commit = head;
  let createdCommit = false;

  if (sourceDirty) {
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "agent-native-portal-index-"),
    );
    const indexPath = path.join(tempRoot, "index");
    try {
      const indexEnv = { GIT_INDEX_FILE: indexPath };
      const added = await executeGit(
        ["add", "--all", "--", "."],
        repositoryPath,
        indexEnv,
      );
      if (added.status !== 0) {
        throw gitFailure(added, "Portal could not snapshot local code.");
      }
      const tree = await requiredGitOutput(
        executeGit,
        ["write-tree"],
        repositoryPath,
        "Portal could not write the local code snapshot.",
        indexEnv,
      );
      const authorName =
        (await optionalGitOutput(
          executeGit,
          ["config", "--get", "user.name"],
          repositoryPath,
        )) ?? "Agent Native Portal";
      const authorEmail =
        (await optionalGitOutput(
          executeGit,
          ["config", "--get", "user.email"],
          repositoryPath,
        )) ?? "portal@agent-native.local";
      const committed = await requiredGitOutput(
        executeGit,
        ["commit-tree", tree, "-p", head, "-m", `Portal handoff ${handoffId}`],
        repositoryPath,
        "Portal could not create the local code snapshot.",
        {
          ...indexEnv,
          GIT_AUTHOR_NAME: authorName,
          GIT_AUTHOR_EMAIL: authorEmail,
          GIT_COMMITTER_NAME: authorName,
          GIT_COMMITTER_EMAIL: authorEmail,
        },
      );
      commit = committed;
      createdCommit = true;
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  }

  const branch = portalBranchName(input.now ?? new Date(), handoffId);
  const pushed = await executeGit(
    ["push", "--no-verify", remoteName, `${commit}:refs/heads/${branch}`],
    repositoryPath,
  );
  if (pushed.status !== 0) {
    throw gitFailure(
      pushed,
      "Portal could not push the code snapshot to the Git remote.",
    );
  }

  return {
    schemaVersion: 1,
    handoffId,
    branch,
    remoteRef: `refs/heads/${branch}`,
    commit,
    sourceBranch,
    sourceDirty,
    createdCommit,
    repositoryName: path.basename(repositoryPath),
    remoteName,
    envPolicy: "load-local",
  };
}

export async function preparePortalWorkspace(input: {
  handoff: unknown;
  workspacePath?: string;
  worktreeRoot?: string;
  runGit?: RunPortalGit;
}): Promise<PortalWorkspace> {
  const executeGit = input.runGit ?? runPortalGit;
  const handoff = parsePortalHandoff(input.handoff);
  const configuredWorkspace = input.workspacePath?.trim();
  if (!configuredWorkspace) {
    throw new Error(
      "Portal needs a configured workspacePath on the paired computer.",
    );
  }

  const repositoryPath = await requiredGitOutput(
    executeGit,
    ["rev-parse", "--show-toplevel"],
    path.resolve(configuredWorkspace),
    "Portal could not find a Git repository on the paired computer.",
  );
  const trackingRef = `refs/remotes/${handoff.remoteName}/${handoff.branch}`;
  const fetched = await executeGit(
    [
      "fetch",
      "--no-tags",
      "--no-prune",
      handoff.remoteName,
      `${handoff.remoteRef}:${trackingRef}`,
    ],
    repositoryPath,
  );
  if (fetched.status !== 0) {
    throw gitFailure(
      fetched,
      "Portal could not fetch the code snapshot on the paired computer.",
    );
  }
  const verified = await executeGit(
    ["cat-file", "-e", `${handoff.commit}^{commit}`],
    repositoryPath,
  );
  if (verified.status !== 0) {
    throw gitFailure(
      verified,
      "Portal fetched the branch but could not verify its commit.",
    );
  }

  const worktreeRoot = path.resolve(
    input.worktreeRoot ?? path.join(codeAgentStoreRoot(), "portals"),
  );
  await fs.promises.mkdir(worktreeRoot, { recursive: true });
  const baseName = `${handoff.handoffId}-${handoff.commit.slice(0, 8)}`;
  let workspacePath = path.join(worktreeRoot, baseName);
  let reused = false;

  if (fs.existsSync(workspacePath)) {
    const existingHead = await executeGit(["rev-parse", "HEAD"], workspacePath);
    const existingStatus = await executeGit(
      ["status", "--porcelain", "--untracked-files=all"],
      workspacePath,
    );
    if (
      existingHead.status === 0 &&
      existingHead.stdout?.trim() === handoff.commit &&
      existingStatus.status === 0 &&
      !existingStatus.stdout?.trim()
    ) {
      reused = true;
    } else {
      workspacePath = path.join(
        worktreeRoot,
        `${baseName}-${crypto.randomUUID().slice(0, 8)}`,
      );
    }
  }

  if (!reused) {
    const created = await executeGit(
      ["worktree", "add", "--detach", workspacePath, handoff.commit],
      repositoryPath,
    );
    if (created.status !== 0) {
      throw gitFailure(
        created,
        "Portal could not create the isolated workspace on the paired computer.",
      );
    }
  }

  return {
    handoff,
    repositoryPath,
    workspacePath,
    environmentRoot: repositoryPath,
    environmentFiles: listPortalEnvironmentFiles(repositoryPath),
    reused,
  };
}

export function parsePortalHandoff(value: unknown): PortalHandoff {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Portal handoff metadata is missing.");
  }
  const record = value as Record<string, unknown>;
  const handoffId = stringField(record.handoffId);
  const branch = stringField(record.branch);
  const remoteRef = stringField(record.remoteRef);
  const commit = stringField(record.commit);
  const repositoryName = stringField(record.repositoryName);
  const remoteName = stringField(record.remoteName);
  if (!handoffId || !branch || !remoteRef || !commit || !repositoryName) {
    throw new Error("Portal handoff metadata is incomplete.");
  }
  assertSafeHandoffId(handoffId);
  assertSafeBranch(branch);
  assertSafeRemoteName(remoteName || "");
  if (remoteRef !== `refs/heads/${branch}`) {
    throw new Error("Portal handoff metadata has an invalid remote ref.");
  }
  if (!/^[a-f0-9]{7,64}$/i.test(commit)) {
    throw new Error("Portal handoff metadata has an invalid commit.");
  }
  if (record.schemaVersion !== 1 || record.envPolicy !== "load-local") {
    throw new Error("Portal handoff metadata has an unsupported version.");
  }
  if (
    typeof record.sourceDirty !== "boolean" ||
    typeof record.createdCommit !== "boolean"
  ) {
    throw new Error("Portal handoff metadata has invalid snapshot state.");
  }
  const sourceBranch = stringField(record.sourceBranch);
  return {
    schemaVersion: 1,
    handoffId,
    branch,
    remoteRef,
    commit,
    sourceBranch,
    sourceDirty: record.sourceDirty,
    createdCommit: record.createdCommit,
    repositoryName,
    remoteName: remoteName || "origin",
    envPolicy: "load-local",
  };
}

export function listPortalEnvironmentFiles(
  root: string,
  mode = process.env.NODE_ENV || "development",
): string[] {
  const normalizedMode = mode.trim().replace(/[^A-Za-z0-9_-]/g, "");
  const names = [
    ...PORTAL_ENV_FILES,
    ...(normalizedMode ? [`.env.${normalizedMode}`] : []),
    ...(normalizedMode ? [`.env.${normalizedMode}.local`] : []),
  ];
  return [...new Set(names)].filter((name) => {
    try {
      return fs.statSync(path.join(root, name)).isFile();
      // coercion-ok: A missing local env file is an intentional absent value.
    } catch {
      return false;
    }
  });
}

export function loadPortalEnvironment(
  root: string,
  mode = process.env.NODE_ENV || "development",
): PortalEnvironment {
  const resolvedRoot = path.resolve(root);
  const files = listPortalEnvironmentFiles(resolvedRoot, mode);
  const values: Record<string, string> = {};
  for (const name of files) {
    const filePath = path.join(resolvedRoot, name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      throw new Error(
        `Portal could not read ${name} on the paired computer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
      );
      if (!match || PORTAL_PROTECTED_ENV_KEYS.has(match[1])) continue;
      values[match[1]] = parsePortalEnvValue(match[2]);
    }
  }
  return { values, files, root: resolvedRoot };
}

function parsePortalEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  const comment = trimmed.indexOf(" #");
  return comment >= 0 ? trimmed.slice(0, comment).trimEnd() : trimmed;
}

function portalBranchName(now: Date, handoffId: string): string {
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = handoffId.slice(0, 8).replace(/[-.]+$/g, "") || "handoff";
  return `portal/${timestamp}-${suffix}`;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertSafeHandoffId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) {
    throw new Error("Portal handoff id is invalid.");
  }
}

function assertSafeBranch(value: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.endsWith("/") ||
    value.endsWith(".")
  ) {
    throw new Error("Portal branch is invalid.");
  }
}

function assertSafeRemoteName(value: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    throw new Error("Portal Git remote name is invalid.");
  }
}

async function requiredGitOutput(
  executeGit: RunPortalGit,
  args: string[],
  cwd: string,
  fallback: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await executeGit(args, cwd, env);
  if (result.status !== 0 || !result.stdout?.trim()) {
    throw gitFailure(result, fallback);
  }
  return result.stdout.trim();
}

async function optionalGitOutput(
  executeGit: RunPortalGit,
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  const result = await executeGit(args, cwd);
  return result.status === 0 ? result.stdout?.trim() || undefined : undefined;
}

function gitFailure(result: PortalGitResult, fallback: string): Error {
  const detail = sanitizeGitError(
    result.stderr?.trim() || result.error?.message,
  );
  return new Error(detail ? `${fallback} ${detail}` : fallback);
}

function sanitizeGitError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/https?:\/\/[^\s/@]+(?::[^\s/@]*)?@/gi, "https://REDACTED@")
    .replace(/\s+/g, " ")
    .slice(0, 800);
}
