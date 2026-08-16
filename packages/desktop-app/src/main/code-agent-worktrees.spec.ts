import { describe, expect, it } from "vitest";

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
