import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCheckpoint,
  getChangedFileNames,
  getChangedPaths,
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
    expect(getChangedPaths(cwd)).toEqual(
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

  it("commits the staged snapshot when an owned file changes after add", () => {
    const cwd = createTempRepo();
    const file = path.join(cwd, "agent.txt");
    const developerFile = path.join(cwd, "developer.txt");
    fs.writeFileSync(file, "before\n");
    fs.writeFileSync(developerFile, "before\n");
    createCheckpoint(cwd, "Initial checkpoint");
    fs.writeFileSync(file, "agent change\n");
    fs.writeFileSync(developerFile, "developer change\n");

    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "an-git-wrapper-"));
    tmpDirs.push(bin);
    const realGit = execFileSync("which", ["git"], {
      encoding: "utf-8",
    }).trim();
    const wrapper = path.join(bin, "git");
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\n"$AGENT_NATIVE_REAL_GIT" "$@"\nstatus=$?\nif [ "$1" = "add" ] && [ "$status" -eq 0 ]; then printf 'developer later\\n' > "$AGENT_NATIVE_RACE_PATH"; unset GIT_INDEX_FILE; "$AGENT_NATIVE_REAL_GIT" add -- "$AGENT_NATIVE_STAGE_PATH"; fi\nexit "$status"\n`,
      { mode: 0o755 },
    );
    const previous = {
      path: process.env.PATH,
      git: process.env.AGENT_NATIVE_REAL_GIT,
      race: process.env.AGENT_NATIVE_RACE_PATH,
      stage: process.env.AGENT_NATIVE_STAGE_PATH,
    };
    process.env.PATH = `${bin}${path.delimiter}${previous.path ?? ""}`;
    process.env.AGENT_NATIVE_REAL_GIT = realGit;
    process.env.AGENT_NATIVE_RACE_PATH = file;
    process.env.AGENT_NATIVE_STAGE_PATH = developerFile;
    try {
      expect(createCheckpoint(cwd, "Agent checkpoint", ["agent.txt"])).toMatch(
        /^[0-9a-f]{40}$/,
      );
    } finally {
      process.env.PATH = previous.path;
      if (previous.git === undefined) delete process.env.AGENT_NATIVE_REAL_GIT;
      else process.env.AGENT_NATIVE_REAL_GIT = previous.git;
      if (previous.race === undefined)
        delete process.env.AGENT_NATIVE_RACE_PATH;
      else process.env.AGENT_NATIVE_RACE_PATH = previous.race;
      if (previous.stage === undefined)
        delete process.env.AGENT_NATIVE_STAGE_PATH;
      else process.env.AGENT_NATIVE_STAGE_PATH = previous.stage;
    }
    expect(
      execFileSync("git", ["show", "HEAD:agent.txt"], {
        cwd,
        encoding: "utf-8",
      }),
    ).toBe("agent change\n");
    expect(
      execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd,
        encoding: "utf-8",
      }).trim(),
    ).toBe("developer.txt");
    expect(fs.readFileSync(file, "utf-8")).toBe("developer later\n");
    expect(getUncommittedStatus(cwd)).toContain("agent.txt");
  });

  it("skips a checkpoint immediately when the checkout lock is held", () => {
    const cwd = createTempRepo();
    fs.writeFileSync(path.join(cwd, "agent.txt"), "before\n");
    createCheckpoint(cwd, "Initial checkpoint");
    fs.writeFileSync(path.join(cwd, "agent.txt"), "after\n");
    fs.mkdirSync(path.join(cwd, ".git", "agent-native-checkpoint.lock"));

    const startedAt = Date.now();
    expect(createCheckpoint(cwd, "Contended checkpoint")).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
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
