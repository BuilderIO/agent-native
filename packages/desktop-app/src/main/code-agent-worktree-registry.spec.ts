import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cleanupDueCodeAgentWorktrees,
  createOrAttachCodeAgentWorktree,
  getManagedCodeAgentWorktree,
  listNamedCodeAgentWorktrees,
  releaseCodeAgentWorktree,
  restoreManagedCodeAgentWorktree,
  worktreeRegistryPath,
} from "./code-agent-worktree-registry.js";

describe("code-agent-worktree-registry", () => {
  it("reuses a named worktree across runs", () => {
    withRepository((root) => {
      const registryPath = worktreeRegistryPath(root);
      const worktreeRoot = path.join(root, "managed-worktrees");
      const selectedFolder = path.join(root, "src");
      fs.mkdirSync(selectedFolder);
      const first = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: selectedFolder,
        worktreeRoot,
        runId: "run-one",
        policy: "named",
        name: "Review branch",
      });
      const second = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: root,
        worktreeRoot,
        runId: "run-two",
        policy: "named",
        name: "review-branch",
      });

      expect(second.id).toBe(first.id);
      expect(second.path).toBe(first.path);
      expect(fs.existsSync(first.path)).toBe(true);
      expect(
        listNamedCodeAgentWorktrees({
          registryPath,
          sourcePath: root,
        }).worktrees,
      ).toMatchObject([
        {
          id: first.id,
          name: "Review branch",
          attached: true,
          state: "attached",
        },
      ]);

      releaseCodeAgentWorktree({
        registryPath,
        worktreeId: first.id,
        runId: "run-one",
      });
      const released = releaseCodeAgentWorktree({
        registryPath,
        worktreeId: first.id,
        runId: "run-two",
      });
      expect(released?.state).toBe("available");
      expect(fs.existsSync(first.path)).toBe(true);
    });
  });

  it("namespaces the same named worktree independently per repository", () => {
    withRepository((firstRoot) => {
      withRepository((secondRoot) => {
        const first = createOrAttachCodeAgentWorktree({
          registryPath: worktreeRegistryPath(firstRoot),
          sourcePath: firstRoot,
          worktreeRoot: path.join(firstRoot, "managed-worktrees"),
          runId: "first-run",
          policy: "named",
          name: "Review branch",
        });
        const second = createOrAttachCodeAgentWorktree({
          registryPath: worktreeRegistryPath(secondRoot),
          sourcePath: secondRoot,
          worktreeRoot: path.join(secondRoot, "managed-worktrees"),
          runId: "second-run",
          policy: "named",
          name: "Review branch",
        });

        expect(second.branch).not.toBe(first.branch);
        expect(second.path).not.toBe(first.path);
        expect(fs.existsSync(first.path)).toBe(true);
        expect(fs.existsSync(second.path)).toBe(true);
      });
    });
  });

  it("keeps distinct names that only differ after the filesystem prefix", () => {
    withRepository((root) => {
      const registryPath = worktreeRegistryPath(root);
      const worktreeRoot = path.join(root, "managed-worktrees");
      const first = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: root,
        worktreeRoot,
        runId: "long-name-one",
        policy: "named",
        name: `${"a".repeat(56)}-one`,
      });
      const second = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: root,
        worktreeRoot,
        runId: "long-name-two",
        policy: "named",
        name: `${"a".repeat(56)}-two`,
      });

      expect(second.id).not.toBe(first.id);
      expect(second.path).not.toBe(first.path);
      expect(second.branch).not.toBe(first.branch);
    });
  });

  it("waits two days before cleaning an empty ephemeral worktree", () => {
    withRepository((root) => {
      const registryPath = worktreeRegistryPath(root);
      const worktree = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: root,
        worktreeRoot: path.join(root, "managed-worktrees"),
        runId: "ephemeral-run",
        policy: "ephemeral",
        now: new Date("2026-08-19T00:00:00.000Z"),
      });
      releaseCodeAgentWorktree({
        registryPath,
        worktreeId: worktree.id,
        runId: "ephemeral-run",
        cleanupAfter: new Date("2026-08-21T00:00:00.000Z"),
        now: new Date("2026-08-19T00:00:00.000Z"),
      });

      expect(
        cleanupDueCodeAgentWorktrees({
          registryPath,
          now: new Date("2026-08-20T23:59:59.000Z"),
        }),
      ).toEqual([]);
      expect(fs.existsSync(worktree.path)).toBe(true);

      const cleaned = cleanupDueCodeAgentWorktrees({
        registryPath,
        now: new Date("2026-08-21T00:00:01.000Z"),
      });
      expect(cleaned).toHaveLength(1);
      expect(
        getManagedCodeAgentWorktree(registryPath, worktree.id)?.state,
      ).toBe("removed");
      expect(fs.existsSync(worktree.path)).toBe(false);
    });
  });

  it("does not refresh an ephemeral cleanup deadline during repeated release", () => {
    withRepository((root) => {
      const registryPath = worktreeRegistryPath(root);
      const worktree = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: root,
        worktreeRoot: path.join(root, "managed-worktrees"),
        runId: "repeated-release",
        policy: "ephemeral",
        now: new Date("2026-08-19T00:00:00.000Z"),
      });
      releaseCodeAgentWorktree({
        registryPath,
        worktreeId: worktree.id,
        runId: "repeated-release",
        cleanupAfter: new Date("2026-08-21T00:00:00.000Z"),
        now: new Date("2026-08-19T00:00:00.000Z"),
      });
      releaseCodeAgentWorktree({
        registryPath,
        worktreeId: worktree.id,
        runId: "repeated-release",
        cleanupAfter: new Date("2026-08-30T00:00:00.000Z"),
        now: new Date("2026-08-20T00:00:00.000Z"),
      });

      expect(
        getManagedCodeAgentWorktree(registryPath, worktree.id)?.cleanupAfter,
      ).toBe("2026-08-21T00:00:00.000Z");
    });
  });

  it("keeps dirty ephemeral worktrees recoverable and restores them", () => {
    withRepository((root) => {
      const registryPath = worktreeRegistryPath(root);
      const worktree = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: root,
        worktreeRoot: path.join(root, "managed-worktrees"),
        runId: "dirty-run",
        policy: "ephemeral",
      });
      fs.writeFileSync(path.join(worktree.path, "notes.txt"), "keep me\n");
      releaseCodeAgentWorktree({
        registryPath,
        worktreeId: worktree.id,
        runId: "dirty-run",
        cleanupAfter: new Date("2026-08-01T00:00:00.000Z"),
      });

      cleanupDueCodeAgentWorktrees({
        registryPath,
        now: new Date("2026-08-22T00:00:00.000Z"),
      });
      expect(
        getManagedCodeAgentWorktree(registryPath, worktree.id)?.state,
      ).toBe("recoverable");
      expect(fs.existsSync(worktree.path)).toBe(true);

      fs.rmSync(worktree.path, { recursive: true, force: true });
      const restored = restoreManagedCodeAgentWorktree({
        registryPath,
        worktreeId: worktree.id,
        runId: "restored-run",
      });
      expect(restored.state).toBe("attached");
      expect(restored.attachedRunIds).toContain("restored-run");
      expect(fs.existsSync(restored.path)).toBe(true);
    });
  });

  it("keeps ephemeral worktrees that contain committed work", () => {
    withRepository((root) => {
      const registryPath = worktreeRegistryPath(root);
      const worktree = createOrAttachCodeAgentWorktree({
        registryPath,
        sourcePath: root,
        worktreeRoot: path.join(root, "managed-worktrees"),
        runId: "committed-run",
        policy: "ephemeral",
      });
      fs.writeFileSync(path.join(worktree.path, "committed.txt"), "keep me\n");
      runGit(["add", "committed.txt"], worktree.path);
      runGit(["commit", "-m", "keep committed work"], worktree.path);
      releaseCodeAgentWorktree({
        registryPath,
        worktreeId: worktree.id,
        runId: "committed-run",
        cleanupAfter: new Date("2026-08-01T00:00:00.000Z"),
      });

      cleanupDueCodeAgentWorktrees({
        registryPath,
        now: new Date("2026-08-22T00:00:00.000Z"),
      });
      expect(
        getManagedCodeAgentWorktree(registryPath, worktree.id),
      ).toMatchObject({
        state: "recoverable",
        lastCleanupError: expect.stringContaining("commits after its base"),
      });
      expect(fs.existsSync(worktree.path)).toBe(true);
    });
  });
});

function withRepository(callback: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-registry-"));
  try {
    runGit(["init", "-b", "main"], root);
    runGit(["config", "user.email", "registry@example.invalid"], root);
    runGit(["config", "user.name", "Registry Test"], root);
    fs.writeFileSync(path.join(root, "README.md"), "registry\n");
    runGit(["add", "README.md"], root);
    runGit(["commit", "-m", "initial"], root);
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}
