import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deriveContentFilesRepositoryIdentity } from "./local-identity";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "content-files-"));
  directories.push(directory);
  return directory;
}

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf-8",
  }).trim();
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("deriveContentFilesRepositoryIdentity", () => {
  it("returns no identity for a non-Git folder", () => {
    expect(
      deriveContentFilesRepositoryIdentity(temporaryDirectory()),
    ).toBeUndefined();
  });

  it("labels a branch without exposing its path", () => {
    const directory = temporaryDirectory();
    git(directory, ["init", "--initial-branch=main"]);
    git(directory, ["config", "user.email", "content@example.test"]);
    git(directory, ["config", "user.name", "Content Test"]);
    fs.writeFileSync(path.join(directory, "note.md"), "# note\n");
    git(directory, ["add", "."]);
    git(directory, ["commit", "-m", "initial"]);

    expect(deriveContentFilesRepositoryIdentity(directory)).toMatchObject({
      branch: "main",
      commit: git(directory, ["rev-parse", "HEAD"]),
    });
    expect(
      deriveContentFilesRepositoryIdentity(directory)?.localId,
    ).not.toContain(directory);
  });

  it("keeps a detached worktree's commit as a label", () => {
    const directory = temporaryDirectory();
    git(directory, ["init"]);
    git(directory, ["config", "user.email", "content@example.test"]);
    git(directory, ["config", "user.name", "Content Test"]);
    fs.writeFileSync(path.join(directory, "note.md"), "# note\n");
    git(directory, ["add", "."]);
    git(directory, ["commit", "-m", "initial"]);
    git(directory, ["checkout", "--detach"]);

    expect(deriveContentFilesRepositoryIdentity(directory)).toMatchObject({
      detached: true,
      commit: git(directory, ["rev-parse", "HEAD"]),
    });
  });

  it("associates Git worktrees with the same local repository", () => {
    const directory = temporaryDirectory();
    const workingCopy = `${directory}-working-copy`;
    directories.push(workingCopy);
    git(directory, ["init", "--initial-branch=main"]);
    git(directory, ["config", "user.email", "content@example.test"]);
    git(directory, ["config", "user.name", "Content Test"]);
    fs.writeFileSync(path.join(directory, "note.md"), "# note\n");
    git(directory, ["add", "."]);
    git(directory, ["commit", "-m", "initial"]);
    git(directory, ["worktree", "add", "-b", "working-copy", workingCopy]);

    expect(deriveContentFilesRepositoryIdentity(workingCopy)?.localId).toBe(
      deriveContentFilesRepositoryIdentity(directory)?.localId,
    );
  });
});
