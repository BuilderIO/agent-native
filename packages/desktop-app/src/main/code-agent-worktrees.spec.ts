import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCodingCommand } from "../../../core/src/coding-tools/index.js";
import {
  cleanupCodeAgentWorktree,
  createCodeAgentWorktree,
  type RunGit,
} from "./code-agent-worktrees.js";

describe("createCodeAgentWorktree", () => {
  it("resolves the repository root and creates an isolated branch from HEAD", () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runGit: RunGit = (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { status: 0, stdout: "/tmp/project\n" };
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return { status: 0, stdout: "abc123\n" };
      }
      return { status: 0, stdout: "Preparing worktree\n" };
    };

    const result = createCodeAgentWorktree({
      sourcePath: "/tmp/project/packages/app",
      worktreeRoot: "/tmp/code-agent-worktrees",
      runId: "task-20260815-abc/unsafe",
      runGit,
    });

    expect(result).toEqual({
      sourcePath: "/tmp/project",
      path: "/tmp/code-agent-worktrees/task-20260815-abc-unsafe",
      branch: "agent-native/task-20260815-abc-unsafe",
      baseCommit: "abc123",
    });
    expect(calls).toEqual([
      {
        args: ["rev-parse", "--show-toplevel"],
        cwd: "/tmp/project/packages/app",
      },
      { args: ["rev-parse", "HEAD"], cwd: "/tmp/project" },
      {
        args: [
          "worktree",
          "add",
          "-b",
          "agent-native/task-20260815-abc-unsafe",
          "/tmp/code-agent-worktrees/task-20260815-abc-unsafe",
          "abc123",
        ],
        cwd: "/tmp/project",
      },
    ]);
  });

  it("surfaces a repository error instead of falling back to the source folder", () => {
    expect(() =>
      createCodeAgentWorktree({
        sourcePath: "/tmp/not-a-repository",
        worktreeRoot: "/tmp/code-agent-worktrees",
        runId: "task-1",
        runGit: () => ({
          status: 128,
          stderr: "fatal: not a git repository",
        }),
      }),
    ).toThrow(
      "Selected folder is not a Git repository. Choose a Git folder to use a worktree.",
    );
  });

  it("keeps a PR command on the generated branch and worktree", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-real-worktree-"));
    const sourcePath = path.join(root, "source");
    const worktreeRoot = path.join(root, "worktrees");
    fs.mkdirSync(sourcePath, { recursive: true });

    try {
      runRealGit(["init", "-b", "main"], sourcePath);
      runRealGit(
        ["config", "user.email", "worktree-test@example.invalid"],
        sourcePath,
      );
      runRealGit(["config", "user.name", "Worktree Test"], sourcePath);
      fs.writeFileSync(path.join(sourcePath, "README.md"), "source\n");
      runRealGit(["add", "README.md"], sourcePath);
      runRealGit(["commit", "-m", "initial"], sourcePath);

      const worktree = createCodeAgentWorktree({
        sourcePath,
        worktreeRoot,
        runId: "task-pr-send-e2e",
      });
      const fakeBin = path.join(worktree.path, ".test-bin");
      fs.mkdirSync(fakeBin, { recursive: true });
      fs.writeFileSync(
        path.join(fakeBin, "gh"),
        '#!/bin/sh\nprintf "fake-gh-pwd=%s\\n" "$PWD"\nprintf "fake-gh-branch=%s\\n" "$(git branch --show-current)"\n',
        { mode: 0o755 },
      );

      const result = await runCodingCommand(
        `PATH="${fakeBin}:$PATH" gh pr create --dry-run`,
        worktree.path,
        30_000,
      );
      const output = result.stdout + result.stderr;
      expect(result.code).toBe(0);
      expect(output).toContain(`fake-gh-pwd=${fs.realpathSync(worktree.path)}`);
      expect(output).toContain("fake-gh-branch=agent-native/task-pr-send-e2e");

      expect(cleanupCodeAgentWorktree(worktree)).toEqual({
        branchRemoved: true,
        worktreeRemoved: true,
      });
      expect(runRealGit(["branch", "--show-current"], sourcePath)).toBe("main");
      expect(fs.readFileSync(path.join(sourcePath, "README.md"), "utf8")).toBe(
        "source\n",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cleanupCodeAgentWorktree", () => {
  it("removes only the generated worktree and its local branch", () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runGit: RunGit = (args, cwd) => {
      calls.push({ args, cwd });
      return { status: 0 };
    };

    expect(
      cleanupCodeAgentWorktree({
        sourcePath: "/tmp/project",
        path: "/tmp/code-agent-worktrees/task-1",
        branch: "agent-native/task-1",
        runGit,
      }),
    ).toEqual({ branchRemoved: true, worktreeRemoved: true });
    expect(calls).toEqual([
      {
        args: [
          "show-ref",
          "--verify",
          "--quiet",
          "refs/heads/agent-native/task-1",
        ],
        cwd: "/tmp/project",
      },
      {
        args: ["branch", "-D", "--", "agent-native/task-1"],
        cwd: "/tmp/project",
      },
    ]);
  });

  it("refuses paths that are not owned by the generated branch", () => {
    expect(() =>
      cleanupCodeAgentWorktree({
        sourcePath: "/tmp/project",
        path: "/tmp/other/task-1",
        branch: "feature/task-1",
        runGit: () => ({ status: 0 }),
      }),
    ).toThrow("Refusing to clean up an unmanaged Code Agent worktree.");
  });
});

function runRealGit(args: string[], cwd: string): string {
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
