import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

const SCRIPT = resolve(import.meta.dirname, "fix-proof.ts");
const repo = mkdtempSync(join(tmpdir(), "fix-proof-"));
after(() => rmSync(repo, { recursive: true, force: true }));

const sh = (...args: string[]) =>
  spawnSync(args[0], args.slice(1), { cwd: repo, encoding: "utf8" });
const proof = (...check: string[]) =>
  sh("node", SCRIPT, "--base", "base", "--", ...check);

sh("git", "init", "-q", "-b", "main");
sh("git", "config", "user.email", "t@example.com");
sh("git", "config", "user.name", "t");
writeFileSync(join(repo, "app.txt"), "broken\n");
sh("git", "add", "-A");
sh("git", "commit", "-qm", "base");
sh("git", "tag", "base");
writeFileSync(join(repo, "app.txt"), "fixed\n");
writeFileSync(join(repo, "app.test.ts"), "check\n");
sh("git", "add", "-A");
sh("git", "commit", "-qm", "fix");

describe("fix-proof", () => {
  it("proves a check that is green on HEAD and red without the fix", () => {
    const r = proof("grep", "-q", "fixed", "app.txt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /proven, red at/);
    assert.equal(readFileSync(join(repo, "app.txt"), "utf8"), "fixed\n");
    assert.equal(sh("git", "status", "--porcelain").stdout, "");
  });

  it("rejects a check that passes without the fix", () => {
    const r = proof("grep", "-q", "check", "app.test.ts");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /also passes without the fix/);
  });

  it("rejects a check that fails on HEAD", () => {
    assert.equal(proof("false").status, 1);
  });

  it("cannot run on a dirty tree", () => {
    writeFileSync(join(repo, "stray.txt"), "x\n");
    const r = proof("true");
    rmSync(join(repo, "stray.txt"));
    assert.equal(r.status, 2);
  });
});
