import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCheckpoint,
  getChangedFileNames,
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

  it("returns false/null outside a git repo instead of throwing", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "an-not-git-"));
    tmpDirs.push(cwd);

    expect(isGitRepo(cwd)).toBe(false);
    expect(createCheckpoint(cwd, "No repo")).toBeNull();
    expect(restoreToCheckpoint(cwd, "HEAD")).toBe(false);
  });
});
