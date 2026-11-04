import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseGitPack } from "./git-http.js";

describe("parseGitPack", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-git-pack-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  function git(args: string[], input?: string): Buffer {
    return execFileSync("git", args, {
      cwd: repo,
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  }

  /** `git rev-list --objects` lines for a commit of near-identical files. */
  function commitSimilarFiles(): string[] {
    git(["init", "--quiet"]);
    const lines = Array.from(
      { length: 400 },
      (_, index) => `line ${index} of the shared text\n`,
    );
    for (let version = 0; version < 4; version += 1) {
      lines[version * 50] = `changed in version ${version}\n`;
      fs.writeFileSync(path.join(repo, `file-${version}.txt`), lines.join(""));
    }
    git(["add", "-A"]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    return git(["rev-list", "--objects", "--all"])
      .toString("utf8")
      .trim()
      .split("\n");
  }

  it.each([
    { kind: "offset", flags: ["--delta-base-offset"] },
    { kind: "object id", flags: [] },
  ])("decodes objects stored as $kind deltas", ({ flags }) => {
    const objectLines = commitSimilarFiles();
    const pack = git(
      ["pack-objects", "--stdout", "--window=10", ...flags],
      `${objectLines.join("\n")}\n`,
    );
    fs.writeFileSync(path.join(repo, "fixture.pack"), pack);
    git(["index-pack", "fixture.pack"]);
    expect(git(["verify-pack", "-v", "fixture.idx"]).toString("utf8")).toMatch(
      /chain length = [1-9]/,
    );

    const objects = parseGitPack(pack);
    const oids = objectLines.map((line) => line.slice(0, 40));
    expect([...objects.keys()].sort()).toEqual([...oids].sort());
    for (const oid of oids) {
      const type = git(["cat-file", "-t", oid]).toString("utf8").trim();
      expect(objects.get(oid)).toEqual({
        type,
        data: git(["cat-file", type, oid]),
      });
    }
  });

  it("rejects a pack whose contents do not match its checksum", () => {
    const objectLines = commitSimilarFiles();
    const pack = git(
      ["pack-objects", "--stdout"],
      `${objectLines.join("\n")}\n`,
    );
    pack.writeUInt8(pack.readUInt8(20) ^ 0xff, 20);

    expect(() => parseGitPack(pack)).toThrow("checksum");
  });
});
