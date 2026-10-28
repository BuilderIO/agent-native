import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

const SCRIPT = resolve(import.meta.dirname, "fix-proof.ts");
const root = mkdtempSync(join(tmpdir(), "fix-proof-"));
const repo = join(root, "repo");
const outside = join(root, "outside.txt");
after(() => rmSync(root, { recursive: true, force: true }));

const sh = (...args: string[]) =>
  spawnSync(args[0], args.slice(1), { cwd: repo, encoding: "utf8" });
const proof = (...check: string[]) =>
  sh("node", SCRIPT, "--base", "base", "--", ...check);
const write = (path: string, text: string) =>
  writeFileSync(join(repo, path), text);

sh("mkdir", repo);
spawnSync("git", ["init", "-q", "-b", "main", repo]);
sh("git", "config", "user.email", "t@example.com");
sh("git", "config", "user.name", "t");
write("app.txt", "broken\n");
write("old.txt", "renamed later\n");
write("gone.txt", "deleted later\n");
write("link.txt", "regular file\n");
sh("git", "add", "-A");
sh("git", "commit", "-qm", "base");
sh("git", "tag", "base");
writeFileSync(outside, "outside\n");
write("app.txt", "fixed\n");
sh("git", "mv", "old.txt", "new.txt");
sh("git", "rm", "-q", "gone.txt");
unlinkSync(join(repo, "link.txt"));
symlinkSync(outside, join(repo, "link.txt"));
write("check.sh", "grep -q fixed app.txt\n");
write("check-input.sh", 'grep -q fixed "$1"\n');
write("input.txt", "fixed\n");
write("app.test.ts", "check\n");
sh("git", "add", "-A");
sh("git", "commit", "-qm", "fix");

function assertBackAtHead() {
  assert.equal(sh("git", "status", "--porcelain").stdout, "");
  assert.equal(readFileSync(join(repo, "app.txt"), "utf8"), "fixed\n");
  assert.equal(existsSync(join(repo, "old.txt")), false);
  assert.equal(existsSync(join(repo, "gone.txt")), false);
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
}

describe("fix-proof", () => {
  it("proves a check that is green on HEAD and red without the fix", () => {
    const r = proof("grep", "-q", "fixed", "app.txt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /proven, red at/);
    assertBackAtHead();
  });

  it("brings back the old path of a rename and a deleted file", () => {
    assert.equal(proof("test", "!", "-f", "old.txt").status, 0);
    assert.equal(proof("test", "!", "-f", "gone.txt").status, 0);
    assertBackAtHead();
  });

  it("replaces a changed symlink instead of writing through it", () => {
    assert.equal(proof("test", "-L", "link.txt").status, 0);
    assertBackAtHead();
  });

  it("keeps a check helper the command names at HEAD", () => {
    const r = proof("sh", "check.sh");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assertBackAtHead();
  });

  it("reverts an added file passed to the check as input", () => {
    const r = proof("sh", "check-input.sh", "input.txt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assertBackAtHead();
  });

  it("ignores untracked files the check writes", () => {
    const r = proof("sh", "-c", "touch out.log; grep -q fixed app.txt");
    rmSync(join(repo, "out.log"));
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("rejects a check that passes without the fix", () => {
    const r = proof("grep", "-q", "check", "app.test.ts");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /also passes without the fix/);
  });

  it("rejects a check that fails on HEAD", () => {
    assert.equal(proof("false").status, 1);
  });

  it("cannot run with uncommitted changes to tracked files", () => {
    write("app.txt", "edited\n");
    const r = proof("true");
    write("app.txt", "fixed\n");
    assert.equal(r.status, 2);
  });
});
