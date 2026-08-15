import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPortalHandoff,
  loadPortalEnvironment,
  parsePortalHandoff,
  preparePortalWorkspace,
  type RunPortalGit,
} from "./portal-workspace.js";

const handoff = {
  schemaVersion: 1 as const,
  handoffId: "handoff-1",
  branch: "portal/20260815123456-handoff",
  remoteRef: "refs/heads/portal/20260815123456-handoff",
  commit: "abcdef1234567",
  sourceBranch: "feature/portal",
  sourceDirty: true,
  createdCommit: true,
  repositoryName: "project",
  remoteName: "origin",
  envPolicy: "load-local" as const,
};

describe("createPortalHandoff", () => {
  it("snapshots dirty code without changing the source checkout and pushes a unique ref", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runGit: RunPortalGit = async (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { status: 0, stdout: "/tmp/project\n" };
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return { status: 0, stdout: "1111111111111\n" };
      }
      if (args[0] === "status") {
        return { status: 0, stdout: " M src/app.ts\n?? notes.txt\n" };
      }
      if (args[0] === "remote")
        return { status: 0, stdout: "git@example.com:project.git\n" };
      if (args[0] === "branch")
        return { status: 0, stdout: "feature/portal\n" };
      if (args[0] === "write-tree")
        return { status: 0, stdout: "2222222222222\n" };
      if (args[0] === "config" && args[2] === "user.name") {
        return { status: 0, stdout: "Steve\n" };
      }
      if (args[0] === "config" && args[2] === "user.email") {
        return { status: 0, stdout: "steve@example.test\n" };
      }
      if (args[0] === "commit-tree")
        return { status: 0, stdout: "3333333333333\n" };
      return { status: 0 };
    };

    const result = await createPortalHandoff({
      sourcePath: "/tmp/project/packages/app",
      handoffId: "handoff-1",
      now: new Date("2026-08-15T12:34:56.000Z"),
      runGit,
    });

    expect(result).toEqual({
      schemaVersion: 1,
      handoffId: "handoff-1",
      branch: "portal/20260815123456-handoff",
      remoteRef: "refs/heads/portal/20260815123456-handoff",
      commit: "3333333333333",
      sourceBranch: "feature/portal",
      sourceDirty: true,
      createdCommit: true,
      repositoryName: "project",
      remoteName: "origin",
      envPolicy: "load-local",
    });
    expect(calls.at(-1)).toEqual({
      args: [
        "push",
        "--no-verify",
        "origin",
        "3333333333333:refs/heads/portal/20260815123456-handoff",
      ],
      cwd: "/tmp/project",
    });
    expect(calls.some(({ args }) => args[0] === "checkout")).toBe(false);
    expect(calls.some(({ args }) => args[0] === "reset")).toBe(false);
  });
});

describe("preparePortalWorkspace", () => {
  it("fetches the exact commit and creates a detached worktree", async () => {
    const worktreeRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "portal-worktree-test-"),
    );
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runGit: RunPortalGit = async (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { status: 0, stdout: "/remote/project\n" };
      }
      return { status: 0 };
    };

    try {
      const result = await preparePortalWorkspace({
        handoff,
        workspacePath: "/remote/project",
        worktreeRoot,
        runGit,
      });

      expect(result).toMatchObject({
        repositoryPath: "/remote/project",
        environmentRoot: "/remote/project",
        reused: false,
      });
      expect(calls).toContainEqual({
        args: [
          "fetch",
          "--no-tags",
          "--no-prune",
          "origin",
          "refs/heads/portal/20260815123456-handoff:refs/remotes/origin/portal/20260815123456-handoff",
        ],
        cwd: "/remote/project",
      });
      expect(calls.at(-1)?.args).toEqual([
        "worktree",
        "add",
        "--detach",
        result.workspacePath,
        handoff.commit,
      ]);
    } finally {
      await fs.promises.rm(worktreeRoot, { recursive: true, force: true });
    }
  });
});

describe("loadPortalEnvironment", () => {
  it("loads current local env files without importing protected runtime keys into the run", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "portal-env-test-"),
    );
    try {
      await fs.promises.writeFile(
        path.join(root, ".env"),
        "PUBLIC_VALUE=base\nSHARED_VALUE=base\nNODE_OPTIONS=unsafe\n",
      );
      await fs.promises.writeFile(
        path.join(root, ".env.local"),
        'SHARED_VALUE=local\nLOCAL_VALUE="quoted value"\n',
      );
      const result = loadPortalEnvironment(root, "development");
      expect(result.files).toEqual([".env", ".env.local"]);
      expect(result.values).toEqual({
        PUBLIC_VALUE: "base",
        SHARED_VALUE: "local",
        LOCAL_VALUE: "quoted value",
      });
      expect(JSON.stringify(result)).not.toContain("unsafe");
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});

describe("parsePortalHandoff", () => {
  it("rejects a ref that does not match the declared branch", () => {
    expect(() =>
      parsePortalHandoff({ ...handoff, remoteRef: "refs/heads/main" }),
    ).toThrow("invalid remote ref");
  });
});
