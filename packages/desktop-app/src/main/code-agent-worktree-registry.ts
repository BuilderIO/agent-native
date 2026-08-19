import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  withFileLockSync,
  writeJsonFileAtomically,
} from "../../../core/src/cli/atomic-json-file.js";
import {
  cleanupCodeAgentWorktree,
  codeAgentWorktreeHasChanges,
  codeAgentWorktreeHasCommitsAfterBase,
  createCodeAgentWorktree,
  createNamedCodeAgentWorktree,
  codeAgentWorktreeNameKey,
  normalizeCodeAgentWorktreeName,
  assertManagedCodeAgentWorktree,
  restoreCodeAgentWorktree,
  resolveCodeAgentRepositoryRoot,
  type CodeAgentWorktreeCleanupResult,
  type CodeAgentWorktreeResult,
  type RunGit,
} from "./code-agent-worktrees.js";

export const CODE_AGENT_WORKTREE_REGISTRY_SCHEMA_VERSION = 1;
export const CODE_AGENT_EPHEMERAL_WORKTREE_RETENTION_MS =
  2 * 24 * 60 * 60 * 1000;

export type CodeAgentWorktreePolicy = "ephemeral" | "named";
export type CodeAgentWorktreeState =
  | "available"
  | "attached"
  | "cleanup-pending"
  | "recoverable"
  | "removed"
  | "error";

export interface CodeAgentManagedWorktree {
  schemaVersion: typeof CODE_AGENT_WORKTREE_REGISTRY_SCHEMA_VERSION;
  id: string;
  name?: string;
  policy: CodeAgentWorktreePolicy;
  sourcePath: string;
  path: string;
  branch: string;
  baseCommit: string;
  state: CodeAgentWorktreeState;
  attachedRunIds: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  cleanupAfter?: string;
  cleanupAttempts: number;
  lastCleanupError?: string;
}

interface CodeAgentWorktreeRegistryFile {
  schemaVersion: typeof CODE_AGENT_WORKTREE_REGISTRY_SCHEMA_VERSION;
  worktrees: CodeAgentManagedWorktree[];
}

export interface CodeAgentWorktreeSummary {
  id: string;
  name: string;
  branch: string;
  path: string;
  sourcePath: string;
  state: CodeAgentWorktreeState;
  attached: boolean;
  lastUsedAt: string;
  lastCleanupError?: string;
}

export interface CodeAgentWorktreeListResult {
  status: "ok" | "unavailable";
  sourcePath: string;
  worktrees: CodeAgentWorktreeSummary[];
  error?: string;
}

export interface CodeAgentWorktreeMutationResult {
  ok: boolean;
  worktree?: CodeAgentManagedWorktree;
  message: string;
  error?: string;
}

function emptyRegistry(): CodeAgentWorktreeRegistryFile {
  return {
    schemaVersion: CODE_AGENT_WORKTREE_REGISTRY_SCHEMA_VERSION,
    worktrees: [],
  };
}

function normalizeRegistry(value: unknown): CodeAgentWorktreeRegistryFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Code Agent worktree registry is unreadable.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== CODE_AGENT_WORKTREE_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      "The Code Agent worktree registry uses an unsupported version.",
    );
  }
  if (!Array.isArray(record.worktrees)) {
    throw new Error("The Code Agent worktree registry is unreadable.");
  }
  const worktrees = record.worktrees.filter(isManagedWorktree);
  if (worktrees.length !== record.worktrees.length) {
    throw new Error(
      "The Code Agent worktree registry contains invalid entries.",
    );
  }
  return { schemaVersion: 1, worktrees };
}

function isManagedWorktree(value: unknown): value is CodeAgentManagedWorktree {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === CODE_AGENT_WORKTREE_REGISTRY_SCHEMA_VERSION &&
    typeof record.id === "string" &&
    (record.name === undefined || typeof record.name === "string") &&
    (record.policy === "ephemeral" || record.policy === "named") &&
    typeof record.sourcePath === "string" &&
    typeof record.path === "string" &&
    typeof record.branch === "string" &&
    typeof record.baseCommit === "string" &&
    isWorktreeState(record.state) &&
    Array.isArray(record.attachedRunIds) &&
    record.attachedRunIds.every((runId) => typeof runId === "string") &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.lastUsedAt === "string" &&
    (record.cleanupAfter === undefined ||
      typeof record.cleanupAfter === "string") &&
    typeof record.cleanupAttempts === "number" &&
    (record.lastCleanupError === undefined ||
      typeof record.lastCleanupError === "string")
  );
}

function isWorktreeState(value: unknown): value is CodeAgentWorktreeState {
  return (
    value === "available" ||
    value === "attached" ||
    value === "cleanup-pending" ||
    value === "recoverable" ||
    value === "removed" ||
    value === "error"
  );
}

function readRegistry(registryPath: string): CodeAgentWorktreeRegistryFile {
  if (!fs.existsSync(registryPath)) return emptyRegistry();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `The Code Agent worktree registry could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return normalizeRegistry(parsed);
}

function writeRegistry(
  registryPath: string,
  registry: CodeAgentWorktreeRegistryFile,
): void {
  writeJsonFileAtomically(registryPath, registry);
}

function withRegistry<T>(
  registryPath: string,
  action: (registry: CodeAgentWorktreeRegistryFile) => T,
): T {
  return withFileLockSync(registryPath, () => {
    const registry = readRegistry(registryPath);
    return action(registry);
  });
}

function withMutableRegistry<T>(
  registryPath: string,
  action: (registry: CodeAgentWorktreeRegistryFile) => T,
): T {
  return withFileLockSync(registryPath, () => {
    const registry = readRegistry(registryPath);
    const result = action(registry);
    writeRegistry(registryPath, registry);
    return result;
  });
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function samePath(left: string, right: string): boolean {
  const resolveComparablePath = (value: string) => {
    try {
      return fs.realpathSync.native(value);
    } catch {
      return path.resolve(value);
    }
  };
  return resolveComparablePath(left) === resolveComparablePath(right);
}

function worktreeSummary(
  worktree: CodeAgentManagedWorktree,
): CodeAgentWorktreeSummary {
  return {
    id: worktree.id,
    name: worktree.name ?? path.basename(worktree.path),
    branch: worktree.branch,
    path: worktree.path,
    sourcePath: worktree.sourcePath,
    state: worktree.state,
    attached: worktree.attachedRunIds.length > 0,
    lastUsedAt: worktree.lastUsedAt,
    lastCleanupError: worktree.lastCleanupError,
  };
}

function updateRuntimeState(
  worktree: CodeAgentManagedWorktree,
  now: string,
): void {
  if (worktree.state === "removed") return;
  if (!fs.existsSync(worktree.path)) {
    worktree.state = "recoverable";
    return;
  }
  if (worktree.attachedRunIds.length > 0) {
    worktree.state = "attached";
  } else if (worktree.policy === "ephemeral" && worktree.cleanupAfter) {
    worktree.state =
      new Date(worktree.cleanupAfter).getTime() <= new Date(now).getTime()
        ? "cleanup-pending"
        : "available";
  } else {
    worktree.state = "available";
  }
}

function addRunId(worktree: CodeAgentManagedWorktree, runId: string): void {
  if (!worktree.attachedRunIds.includes(runId)) {
    worktree.attachedRunIds.push(runId);
  }
}

function removeRunId(worktree: CodeAgentManagedWorktree, runId: string): void {
  worktree.attachedRunIds = worktree.attachedRunIds.filter(
    (attachedRunId) => attachedRunId !== runId,
  );
}

function buildManagedWorktree(input: {
  result: CodeAgentWorktreeResult;
  policy: CodeAgentWorktreePolicy;
  name?: string;
  runId: string;
  now: string;
}): CodeAgentManagedWorktree {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    ...(input.name ? { name: input.name } : {}),
    policy: input.policy,
    sourcePath: input.result.sourcePath,
    path: input.result.path,
    branch: input.result.branch,
    baseCommit: input.result.baseCommit,
    state: "attached",
    attachedRunIds: [input.runId],
    createdAt: input.now,
    updatedAt: input.now,
    lastUsedAt: input.now,
    cleanupAttempts: 0,
  };
}

function ensureNamedWorktree(
  worktree: CodeAgentManagedWorktree,
  runId: string,
  now: string,
  runGit?: RunGit,
): CodeAgentManagedWorktree {
  if (worktree.policy !== "named") {
    throw new Error("The selected worktree is not reusable.");
  }
  if (!fs.existsSync(worktree.path)) {
    restoreCodeAgentWorktree({
      sourcePath: worktree.sourcePath,
      path: worktree.path,
      branch: worktree.branch,
      baseCommit: worktree.baseCommit,
      runGit,
    });
  } else {
    assertManagedCodeAgentWorktree({
      sourcePath: worktree.sourcePath,
      path: worktree.path,
      branch: worktree.branch,
      runGit,
    });
  }
  addRunId(worktree, runId);
  worktree.state = "attached";
  worktree.updatedAt = now;
  worktree.lastUsedAt = now;
  worktree.lastCleanupError = undefined;
  return worktree;
}

export function worktreeRegistryPath(storeRoot: string): string {
  return path.join(path.resolve(storeRoot), "worktrees.json");
}

export function listNamedCodeAgentWorktrees(input: {
  registryPath: string;
  sourcePath: string;
  now?: Date;
  runGit?: RunGit;
}): CodeAgentWorktreeListResult {
  const now = nowIso(input.now);
  try {
    const sourcePath = resolveCodeAgentRepositoryRoot({
      sourcePath: input.sourcePath,
      runGit: input.runGit,
    });
    return withMutableRegistry(input.registryPath, (registry) => {
      for (const worktree of registry.worktrees)
        updateRuntimeState(worktree, now);
      return {
        status: "ok",
        sourcePath,
        worktrees: registry.worktrees
          .filter(
            (worktree) =>
              worktree.policy === "named" &&
              samePath(worktree.sourcePath, sourcePath) &&
              worktree.state !== "removed",
          )
          .sort((left, right) => left.name!.localeCompare(right.name!))
          .map(worktreeSummary),
      };
    });
  } catch (error) {
    return {
      status: "unavailable",
      sourcePath: path.resolve(input.sourcePath),
      worktrees: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createOrAttachCodeAgentWorktree(input: {
  registryPath: string;
  sourcePath: string;
  worktreeRoot: string;
  runId: string;
  policy: CodeAgentWorktreePolicy;
  name?: string;
  now?: Date;
  runGit?: RunGit;
}): CodeAgentManagedWorktree {
  const now = nowIso(input.now);
  const sourcePath = resolveCodeAgentRepositoryRoot({
    sourcePath: input.sourcePath,
    runGit: input.runGit,
  });
  const name =
    input.policy === "named"
      ? normalizeCodeAgentWorktreeName(input.name)
      : undefined;
  if (input.policy === "named" && !name) {
    throw new Error("Choose a name for the reusable worktree.");
  }

  return withMutableRegistry(input.registryPath, (registry) => {
    if (name) {
      const existing = registry.worktrees.find(
        (worktree) =>
          worktree.policy === "named" &&
          samePath(worktree.sourcePath, sourcePath) &&
          codeAgentWorktreeNameKey(worktree.name) ===
            codeAgentWorktreeNameKey(name),
      );
      if (existing)
        return ensureNamedWorktree(existing, input.runId, now, input.runGit);
    }

    const result =
      input.policy === "named"
        ? createNamedCodeAgentWorktree({
            sourcePath,
            worktreeRoot: input.worktreeRoot,
            name: name!,
            runGit: input.runGit,
          })
        : createCodeAgentWorktree({
            sourcePath,
            worktreeRoot: input.worktreeRoot,
            runId: input.runId,
            runGit: input.runGit,
          });
    const worktree = buildManagedWorktree({
      result,
      policy: input.policy,
      name: name ?? undefined,
      runId: input.runId,
      now,
    });
    registry.worktrees.push(worktree);
    return worktree;
  });
}

export function attachCodeAgentWorktree(input: {
  registryPath: string;
  worktreeId: string;
  runId: string;
  now?: Date;
  runGit?: RunGit;
}): CodeAgentManagedWorktree {
  const now = nowIso(input.now);
  return withMutableRegistry(input.registryPath, (registry) => {
    const worktree = registry.worktrees.find(
      (candidate) => candidate.id === input.worktreeId,
    );
    if (!worktree || worktree.state === "removed") {
      throw new Error("The selected worktree is no longer available.");
    }
    if (worktree.policy !== "named") {
      throw new Error("Only named worktrees can be reused.");
    }
    return ensureNamedWorktree(worktree, input.runId, now, input.runGit);
  });
}

export function releaseCodeAgentWorktree(input: {
  registryPath: string;
  worktreeId: string;
  runId: string;
  cleanupAfter?: Date;
  now?: Date;
}): CodeAgentManagedWorktree | null {
  const now = nowIso(input.now);
  return withMutableRegistry(input.registryPath, (registry) => {
    const worktree = registry.worktrees.find(
      (candidate) => candidate.id === input.worktreeId,
    );
    if (!worktree) return null;
    removeRunId(worktree, input.runId);
    worktree.updatedAt = now;
    worktree.lastUsedAt = now;
    if (worktree.policy === "ephemeral" && input.cleanupAfter) {
      worktree.cleanupAfter = input.cleanupAfter.toISOString();
    }
    updateRuntimeState(worktree, now);
    return worktree;
  });
}

export function cleanupDueCodeAgentWorktrees(input: {
  registryPath: string;
  now?: Date;
  runGit?: RunGit;
  canRemove?: (worktree: CodeAgentManagedWorktree) => boolean;
}): CodeAgentManagedWorktree[] {
  const nowDate = input.now ?? new Date();
  const now = nowDate.toISOString();
  return withMutableRegistry(input.registryPath, (registry) => {
    const cleaned: CodeAgentManagedWorktree[] = [];
    for (const worktree of registry.worktrees) {
      updateRuntimeState(worktree, now);
      if (
        worktree.policy !== "ephemeral" ||
        worktree.state === "removed" ||
        worktree.attachedRunIds.length > 0 ||
        !worktree.cleanupAfter ||
        new Date(worktree.cleanupAfter).getTime() > nowDate.getTime()
      ) {
        continue;
      }
      if (input.canRemove && !input.canRemove(worktree)) continue;
      try {
        const hasUncommittedChanges =
          fs.existsSync(worktree.path) &&
          codeAgentWorktreeHasChanges({
            path: worktree.path,
            runGit: input.runGit,
          });
        const hasCommittedChanges = codeAgentWorktreeHasCommitsAfterBase({
          sourcePath: worktree.sourcePath,
          branch: worktree.branch,
          baseCommit: worktree.baseCommit,
          runGit: input.runGit,
        });
        if (hasUncommittedChanges || hasCommittedChanges) {
          worktree.state = "recoverable";
          worktree.lastCleanupError = hasCommittedChanges
            ? "Worktree contains commits after its base; it was kept for recovery."
            : "Worktree has uncommitted changes; it was kept for recovery.";
          worktree.cleanupAttempts += 1;
          worktree.updatedAt = now;
          continue;
        }
        const result: CodeAgentWorktreeCleanupResult = cleanupCodeAgentWorktree(
          {
            sourcePath: worktree.sourcePath,
            path: worktree.path,
            branch: worktree.branch,
            runGit: input.runGit,
          },
        );
        if (!result.worktreeRemoved || !result.branchRemoved) {
          throw new Error("Git did not fully remove the worktree and branch.");
        }
        worktree.state = "removed";
        worktree.updatedAt = now;
        worktree.cleanupAttempts += 1;
        worktree.lastCleanupError = undefined;
        cleaned.push(worktree);
      } catch (error) {
        worktree.state = "error";
        worktree.lastCleanupError =
          error instanceof Error ? error.message : String(error);
        worktree.cleanupAttempts += 1;
        worktree.updatedAt = now;
      }
    }
    return cleaned;
  });
}

export function restoreManagedCodeAgentWorktree(input: {
  registryPath: string;
  worktreeId: string;
  runId?: string;
  now?: Date;
  runGit?: RunGit;
}): CodeAgentManagedWorktree {
  const now = nowIso(input.now);
  return withMutableRegistry(input.registryPath, (registry) => {
    const worktree = registry.worktrees.find(
      (candidate) => candidate.id === input.worktreeId,
    );
    if (!worktree) throw new Error("The worktree could not be found.");
    if (fs.existsSync(worktree.path)) {
      assertManagedCodeAgentWorktree({
        sourcePath: worktree.sourcePath,
        path: worktree.path,
        branch: worktree.branch,
        runGit: input.runGit,
      });
      if (input.runId) addRunId(worktree, input.runId);
      updateRuntimeState(worktree, now);
      worktree.cleanupAfter = undefined;
      worktree.lastCleanupError = undefined;
      return worktree;
    }
    const result = restoreCodeAgentWorktree({
      sourcePath: worktree.sourcePath,
      path: worktree.path,
      branch: worktree.branch,
      baseCommit: worktree.baseCommit,
      runGit: input.runGit,
    });
    worktree.sourcePath = result.sourcePath;
    if (input.runId) addRunId(worktree, input.runId);
    worktree.state =
      worktree.attachedRunIds.length > 0 ? "attached" : "available";
    worktree.updatedAt = now;
    worktree.lastUsedAt = now;
    worktree.cleanupAfter = undefined;
    worktree.lastCleanupError = undefined;
    return worktree;
  });
}

export function getManagedCodeAgentWorktree(
  registryPath: string,
  worktreeId: string,
): CodeAgentManagedWorktree | null {
  return withRegistry(
    registryPath,
    (registry) =>
      registry.worktrees.find((worktree) => worktree.id === worktreeId) ?? null,
  );
}
