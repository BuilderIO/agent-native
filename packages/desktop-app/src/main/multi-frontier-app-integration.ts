import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { redactMultiFrontierSensitiveText } from "../../shared/multi-frontier-ipc.js";
import type { SubscriptionStatus } from "../../shared/subscription-status.js";
import {
  isClaudeSubscriptionStatus,
  readClaudeSubscriptionStatus,
} from "./claude-subscription.js";
import { CodexSubscriptionAdapter } from "./codex-subscription.js";
import {
  registerMultiFrontierIpc,
  type MultiFrontierIpcMain,
} from "./ipc/multi-frontier.js";
import { MultiFrontierHost } from "./multi-frontier-host.js";
import { MultiFrontierManager } from "./multi-frontier-manager.js";
import { pauseRecoveredMultiFrontierRuns } from "./multi-frontier-runtime.js";
import { createMultiFrontierSettingsStore } from "./multi-frontier-settings-store.js";

const execFileAsync = promisify(execFile);
const MAX_EVIDENCE_BYTES = 16 * 1024;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024;
const MAX_SNAPSHOT_PATCH_BYTES = 256 * 1024;
const SAFE_WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

export interface RegisteredCodeAgentWorkspace {
  id: string;
  path: string;
}

export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  overflow?: boolean;
}

export type RunGitCommand = (
  cwd: string,
  args: readonly string[],
  maxOutputBytes?: number,
) => Promise<GitCommandResult>;

export interface MultiFrontierAppIntegration {
  readonly host: MultiFrontierHost;
  readonly manager: MultiFrontierManager;
  readonly codex: CodexSubscriptionAdapter;
  readonly recoveredCount: number;
  dispose(): Promise<void>;
}

export interface MultiFrontierQuitEvent {
  preventDefault(): void;
}

export interface MultiFrontierAppIntegrationOptions {
  ipcMain: MultiFrontierIpcMain;
  storeRoot: string;
  loginCwd: string;
  listWorkspaces(): {
    selectedPath?: string;
    workspaces: readonly RegisteredCodeAgentWorkspace[];
  };
  resolveDirectory(value: unknown): string | null;
  createCodexAdapter?: () => CodexSubscriptionAdapter;
  readClaudeStatus?: () => Promise<SubscriptionStatus>;
  runGit?: RunGitCommand;
  pauseRecoveredRuns?: () => readonly unknown[];
}

/**
 * Installs the one main-process Multi-Frontier stack. It is deliberately lazy:
 * recovery writes only durable pause records and no provider process starts
 * before a status or collaboration request needs one.
 */
export function initializeMultiFrontierAppIntegration(
  options: MultiFrontierAppIntegrationOptions,
): MultiFrontierAppIntegration {
  const codex =
    options.createCodexAdapter?.() ?? new CodexSubscriptionAdapter();
  const readClaudeStatus =
    options.readClaudeStatus ?? (() => readClaudeSubscriptionStatus());
  const workspace = createRegisteredWorkspaceResolver({
    listWorkspaces: options.listWorkspaces,
    resolveDirectory: options.resolveDirectory,
  });
  const runGit = options.runGit ?? runGitCommand;
  const manager = new MultiFrontierManager({
    resolveWorkspaceCwd: async (workspaceId) =>
      workspace.resolveId(workspaceId),
    isSubscriptionConnected: async (providerId) => {
      if (providerId === "codex") {
        const status = await codex.start();
        return (
          status.connectionState === "connected" &&
          status.authMethod === "ChatGPT"
        );
      }
      return isClaudeSubscriptionStatus(await readClaudeStatus());
    },
    readRepositoryEvidence: (cwd) => readBoundedRepositoryEvidence(cwd, runGit),
    snapshotWorkspace: (input) =>
      captureImmutableWorkspaceSnapshot({
        ...input,
        storeRoot: options.storeRoot,
        runGit,
      }),
  });
  const host = new MultiFrontierHost({
    coordinator: manager,
    settingsStore: createMultiFrontierSettingsStore(
      path.join(options.storeRoot, "multi-frontier-settings.json"),
    ),
    resolveWorkspace: async (requestedCwd) => ({
      workspaceId: workspace.resolveRequested(requestedCwd) ?? "unavailable",
    }),
    loginCwd: options.loginCwd,
    createCodexAdapter: () => codex,
    readClaudeStatus,
  });
  const unregisterIpc = registerMultiFrontierIpc({
    ipcMain: options.ipcMain,
    host,
  });
  const recovered = (
    options.pauseRecoveredRuns ?? pauseRecoveredMultiFrontierRuns
  )();
  let disposePromise: Promise<void> | undefined;

  return {
    host,
    manager,
    codex,
    recoveredCount: recovered.length,
    dispose() {
      if (!disposePromise) {
        unregisterIpc();
        disposePromise = host.dispose();
      }
      return disposePromise;
    },
  };
}

export function createMultiFrontierQuitGuard(options: {
  dispose(): Promise<void>;
  reissueQuit(): void;
}): (event: MultiFrontierQuitEvent) => boolean {
  let reissued = false;
  let disposing: Promise<void> | undefined;
  return (event) => {
    if (reissued) return false;
    event.preventDefault();
    if (!disposing) {
      disposing = options
        .dispose()
        .catch(() => undefined)
        .finally(() => {
          reissued = true;
          options.reissueQuit();
        });
    }
    return true;
  };
}

export function createRegisteredWorkspaceResolver(options: {
  listWorkspaces(): {
    selectedPath?: string;
    workspaces: readonly RegisteredCodeAgentWorkspace[];
  };
  resolveDirectory(value: unknown): string | null;
}): {
  resolveRequested(requestedCwd: string | undefined): string | null;
  resolveId(workspaceId: string): string | null;
} {
  const registered = () => {
    const state = options.listWorkspaces();
    return state.workspaces.filter(
      (workspace) =>
        SAFE_WORKSPACE_ID.test(workspace.id) &&
        options.resolveDirectory(workspace.path) === workspace.path,
    );
  };

  return {
    resolveRequested(requestedCwd) {
      const state = options.listWorkspaces();
      const requested = options.resolveDirectory(
        requestedCwd ?? state.selectedPath,
      );
      if (!requested) return null;
      return (
        registered().find((workspace) => workspace.path === requested)?.id ??
        null
      );
    },
    resolveId(workspaceId) {
      if (!SAFE_WORKSPACE_ID.test(workspaceId)) return null;
      return (
        registered().find((workspace) => workspace.id === workspaceId)?.path ??
        null
      );
    },
  };
}

export async function readBoundedRepositoryEvidence(
  cwd: string,
  runGit: RunGitCommand = runGitCommand,
): Promise<string> {
  const [head, status, diffStat, diffCheck] = await Promise.all([
    runGit(cwd, ["rev-parse", "HEAD"]),
    runGit(cwd, ["status", "--short"]),
    runGit(cwd, ["diff", "--stat"]),
    runGit(cwd, ["diff", "--check"]),
  ]);
  return formatRepositoryEvidence({ head, status, diffStat, diffCheck });
}

export async function captureImmutableWorkspaceSnapshot(input: {
  cwd: string;
  workspaceId: string;
  storeRoot: string;
  runGit?: RunGitCommand;
}): Promise<{ contentRef: string; contentHash: string; testOutput: string }> {
  if (!SAFE_WORKSPACE_ID.test(input.workspaceId)) {
    throw new Error("A safe workspace id is required for checkpointing.");
  }
  const evidence = await readBoundedRepositoryEvidence(
    input.cwd,
    input.runGit ?? runGitCommand,
  );
  const patch = await collectWorkspacePatch(
    input.cwd,
    input.runGit ?? runGitCommand,
  );
  const content = [
    "# Multi-Frontier immutable checkpoint",
    `# workspaceId: ${input.workspaceId}`,
    ...evidence.split("\n").map((line) => `# ${line}`),
    "",
    patch,
  ].join("\n");
  const contentHash = createHash("sha256").update(content).digest("hex");
  const checkpointDirectory = path.join(
    input.storeRoot,
    "multi-frontier-checkpoints",
  );
  const snapshotPath = path.join(checkpointDirectory, `${contentHash}.patch`);
  fs.mkdirSync(checkpointDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(checkpointDirectory, 0o700);
  try {
    fs.writeFileSync(snapshotPath, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = fs.readFileSync(snapshotPath, "utf8");
    if (createHash("sha256").update(existing).digest("hex") !== contentHash) {
      throw new Error("The immutable checkpoint evidence is inconsistent.");
    }
  }
  fs.chmodSync(snapshotPath, 0o600);
  return {
    contentRef: `file:${snapshotPath}`,
    contentHash,
    testOutput: extractDiffCheckSummary(evidence),
  };
}

export async function runGitCommand(
  cwd: string,
  args: readonly string[],
  maxOutputBytes = MAX_GIT_OUTPUT_BYTES,
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: maxOutputBytes,
      windowsHide: true,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof result.code === "number" ? result.code : 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? { overflow: true }
        : {}),
    };
  }
}

async function collectWorkspacePatch(
  cwd: string,
  runGit: RunGitCommand,
): Promise<string> {
  const tracked = await runGit(
    cwd,
    ["diff", "--binary", "--no-ext-diff", "--"],
    MAX_SNAPSHOT_PATCH_BYTES + 1,
  );
  if (tracked.exitCode !== 0 || tracked.overflow) {
    throw new Error("Unable to capture an immutable tracked-file checkpoint.");
  }
  const chunks = [tracked.stdout];
  let bytes = Buffer.byteLength(tracked.stdout, "utf8");
  if (bytes > MAX_SNAPSHOT_PATCH_BYTES) {
    throw new Error("The immutable checkpoint exceeds the size limit.");
  }

  const untracked = await runGit(
    cwd,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    MAX_SNAPSHOT_PATCH_BYTES + 1,
  );
  if (untracked.exitCode !== 0 || untracked.overflow) {
    throw new Error("Unable to enumerate untracked checkpoint files.");
  }
  for (const relativePath of untracked.stdout.split("\0")) {
    if (!relativePath) continue;
    const absolutePath = path.resolve(cwd, relativePath);
    if (
      path.relative(cwd, absolutePath).startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error("An untracked checkpoint path escapes its workspace.");
    }
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch {
      throw new Error("An untracked checkpoint file is unavailable.");
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (stat.size + bytes > MAX_SNAPSHOT_PATCH_BYTES) {
      throw new Error("The immutable checkpoint exceeds the size limit.");
    }
    const diff = await runGit(
      cwd,
      ["diff", "--no-index", "--binary", "--", NULL_DEVICE, relativePath],
      MAX_SNAPSHOT_PATCH_BYTES - bytes + 1,
    );
    if ((diff.exitCode !== 0 && diff.exitCode !== 1) || diff.overflow) {
      throw new Error("Unable to capture an untracked checkpoint file.");
    }
    bytes += Buffer.byteLength(diff.stdout, "utf8");
    if (bytes > MAX_SNAPSHOT_PATCH_BYTES) {
      throw new Error("The immutable checkpoint exceeds the size limit.");
    }
    chunks.push(diff.stdout);
  }
  return chunks.join("");
}

function formatRepositoryEvidence(input: {
  head: GitCommandResult;
  status: GitCommandResult;
  diffStat: GitCommandResult;
  diffCheck: GitCommandResult;
}): string {
  return boundEvidence(
    [
      formatGitResult("git rev-parse HEAD", input.head),
      formatGitResult("git status --short", input.status),
      formatGitResult("git diff --stat", input.diffStat),
      formatGitResult("git diff --check", input.diffCheck),
    ].join("\n\n"),
  );
}

function formatGitResult(label: string, result: GitCommandResult): string {
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  return `${label} exit=${result.exitCode}${output ? `\n${output}` : ""}`;
}

function extractDiffCheckSummary(evidence: string): string {
  const match = /git diff --check exit=(\d+)(?:\n([^\n]*))?/.exec(evidence);
  if (!match)
    return "Checks 1 failed. git diff --check evidence was unavailable.";
  if (match[1] === "0") {
    return "Checks 1 passed. git diff --check found no errors.";
  }
  const detail = match[2]?.trim();
  return `Checks 1 failed. git diff --check exit=${match[1]}${detail ? `: ${detail}` : ""}`;
}

function boundEvidence(value: string): string {
  return Buffer.from(redactMultiFrontierSensitiveText(value), "utf8")
    .subarray(0, MAX_EVIDENCE_BYTES)
    .toString("utf8");
}
