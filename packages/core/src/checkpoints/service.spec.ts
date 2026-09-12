import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCheckpoint,
  getChangedFileNames,
  getUncommittedStatus,
  hasUncommittedChanges,
  isGitRepo,
  restoreToCheckpoint,
} from "./service.js";

describe("checkpoint service", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempRepo() {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "an-checkpoint-"));
    tmpDirs.push(cwd);
    execFileSync("git", ["init"], { cwd, stdio: "pipe" });
    return cwd;
  }

  it("reports raw clean and dirty status for checkpoint guards", () => {
    const cwd = createTempRepo();

    expect(getUncommittedStatus(cwd)).toBe("");

    fs.writeFileSync(path.join(cwd, "new.txt"), "new\n");

    expect(getUncommittedStatus(cwd)).toContain("?? new.txt");
  });

  it("creates a checkpoint commit and restores tracked and added files", () => {
    const cwd = createTempRepo();
    const trackedPath = path.join(cwd, "tracked.txt");
    const addedPath = path.join(cwd, "added.txt");

    fs.writeFileSync(trackedPath, "original\n");
    const sha = createCheckpoint(cwd, "Initial checkpoint");

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(isGitRepo(cwd)).toBe(true);
    expect(hasUncommittedChanges(cwd)).toBe(false);

    fs.writeFileSync(trackedPath, "changed\n");
    fs.writeFileSync(addedPath, "new\n");

    expect(hasUncommittedChanges(cwd)).toBe(true);
    expect(getChangedFileNames(cwd)).toEqual(
      expect.arrayContaining(["tracked.txt", "added.txt"]),
    );

    expect(createCheckpoint(cwd, "Pre-restore checkpoint")).toMatch(
      /^[0-9a-f]{40}$/,
    );
    expect(restoreToCheckpoint(cwd, sha!)).toBe(true);
    expect(fs.readFileSync(trackedPath, "utf-8")).toBe("original\n");
    expect(fs.existsSync(addedPath)).toBe(false);
  });

  it("commits only the paths owned by the agent turn", () => {
    const cwd = createTempRepo();
    fs.writeFileSync(path.join(cwd, "agent.txt"), "before\n");
    fs.writeFileSync(path.join(cwd, "developer.txt"), "before\n");
    createCheckpoint(cwd, "Initial checkpoint");

    fs.writeFileSync(path.join(cwd, "agent.txt"), "agent change\n");
    fs.writeFileSync(path.join(cwd, "developer.txt"), "developer change\n");

    expect(createCheckpoint(cwd, "Agent checkpoint", ["agent.txt"])).toMatch(
      /^[0-9a-f]{40}$/,
    );
    expect(
      execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], {
        cwd,
        encoding: "utf-8",
      }).trim(),
    ).toBe("agent.txt");
    expect(getUncommittedStatus(cwd)).toContain("developer.txt");
  });

  it("treats agent-owned paths as literals instead of Git pathspecs", () => {
    const cwd = createTempRepo();
    const literalPathspec = ":(glob)**";
    fs.writeFileSync(path.join(cwd, literalPathspec), "before\n");
    fs.writeFileSync(path.join(cwd, "developer.txt"), "before\n");
    createCheckpoint(cwd, "Initial checkpoint");

    fs.writeFileSync(path.join(cwd, literalPathspec), "agent change\n");
    fs.writeFileSync(path.join(cwd, "developer.txt"), "developer change\n");

    expect(
      createCheckpoint(cwd, "Literal checkpoint", [literalPathspec]),
    ).toMatch(/^[0-9a-f]{40}$/);
    expect(
      execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], {
        cwd,
        encoding: "utf-8",
      }).trim(),
    ).toBe(literalPathspec);
    expect(getUncommittedStatus(cwd)).toContain("developer.txt");
  });

  it("returns false/null outside a git repo instead of throwing", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "an-not-git-"));
    tmpDirs.push(cwd);

    expect(isGitRepo(cwd)).toBe(false);
    expect(getUncommittedStatus(cwd)).toBeNull();
    expect(createCheckpoint(cwd, "No repo")).toBeNull();
    expect(restoreToCheckpoint(cwd, "HEAD")).toBe(false);
  });
});
