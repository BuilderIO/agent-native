import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
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
const shim = join(root, "bin");
const realGit = spawnSync("sh", ["-c", "command -v git"], {
  encoding: "utf8",
}).stdout.trim();
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
write("feature.mjs", "export const value = 'broken';\n");
write("old.txt", "renamed later\n");
write("gone.txt", "deleted later\n");
write("link.txt", "regular file\n");
write("tool.sh", "echo broken\n");
chmodSync(join(repo, "tool.sh"), 0o755);
sh("git", "add", "-A");
sh("git", "commit", "-qm", "base");
sh("git", "tag", "base");
writeFileSync(outside, "outside\n");
write("app.txt", "fixed\n");
write("feature.mjs", "export const value = 'fixed';\n");
sh("git", "mv", "old.txt", "new.txt");
sh("git", "rm", "-q", "gone.txt");
unlinkSync(join(repo, "link.txt"));
symlinkSync(outside, join(repo, "link.txt"));
write("check.sh", "grep -q fixed app.txt\n");
write("check-input.sh", 'grep -q fixed "$1"\n');
write("check-log.sh", "touch out.log; grep -q fixed app.txt\n");
write("interrupted.sh", "exit 130\n");
write(
  "assertion.test.js",
  `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { value } from "./feature.mjs";\ntest("fix assertion", () => assert.equal(value, "fixed"));\n`,
);
write(
  "feature.test.js",
  `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { value } from "./feature.mjs";\ntest("feature is present", () => assert.equal(value, "fixed"));\n`,
);
write("new-feature.mjs", "export const value = 'fixed';\n");
write(
  "new-feature.test.js",
  `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { value } from "./new-feature.mjs";\ntest("new feature is present", () => assert.equal(value, "fixed"));\n`,
);
write("input.txt", "fixed\n");
write("tool.sh", "echo fixed\n");
mkdirSync(join(repo, "nested/dir"), { recursive: true });
write("nested/dir/added.txt", "fixed\n");
write("app.test.ts", "check\n");
sh("git", "add", "-A");
sh("git", "commit", "-qm", "fix");
write("other.txt", "second fix\n");
sh("git", "add", "-A");
sh("git", "commit", "-qm", "second fix");
sh("git", "tag", "second");
write("shared.txt", "fixed-a\n");
sh("git", "add", "-A");
sh("git", "commit", "-qm", "shared fix");
sh("git", "tag", "shared");
write("shared.txt", "fixed-a\nlater\n");
sh("git", "commit", "-qam", "later edit to the same file");

function assertBackAtHead() {
  assert.equal(sh("git", "status", "--porcelain").stdout, "");
  assert.equal(readFileSync(join(repo, "app.txt"), "utf8"), "fixed\n");
  assert.equal(existsSync(join(repo, "old.txt")), false);
  assert.equal(existsSync(join(repo, "gone.txt")), false);
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
  assert.equal(statSync(join(repo, "tool.sh")).mode & 0o111, 0o111);
}

mkdirSync(shim);
writeFileSync(
  join(shim, "git"),
  `#!/bin/sh\ncase "$1" in checkout|rm|restore|reset) echo "blocked: git $1" >&2; exit 1;; esac\nexec "${realGit}" "$@"\n`,
);
chmodSync(join(shim, "git"), 0o755);

describe("fix-proof", () => {
  it("proves a non-test check locally without a line the feedback gate would re-run", () => {
    const r = proof("grep", "-q", "fixed", "app.txt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^fix-proof: proven locally only \(/);
    assert.doesNotMatch(r.stdout, /fix-proof: proven, red at/);
    assertBackAtHead();
  });

  it("accepts an actual failing Node test as red proof", () => {
    const r = proof("node", "--test", "assertion.test.js");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^fix-proof: proven, red at/);
    assertBackAtHead();
  });

  it("does not accept a missing module as red test proof", () => {
    const r = proof("node", "--test", "new-feature.test.js");
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /did not report a test failure/);
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

  it("never runs git checkout, rm, restore, or reset", () => {
    const r = spawnSync(
      "node",
      [SCRIPT, "--base", "base", "--", "grep", "-q", "fixed", "app.txt"],
      {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assertBackAtHead();
  });

  it("puts back the base content and executable bit of a changed script", () => {
    const r = proof("test", "-x", "tool.sh");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /also passes without the fix/);
    assert.equal(proof("grep", "-q", "fixed", "tool.sh").status, 0);
    assertBackAtHead();
  });

  it("removes an added file and its emptied directories on the red run", () => {
    const r = proof("test", "-d", "nested");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(existsSync(join(repo, "nested/dir/added.txt")), true);
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
    const r = proof("sh", "check-log.sh");
    rmSync(join(repo, "out.log"));
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("with --fix, reverts only that commit", () => {
    const own = sh(
      "node",
      SCRIPT,
      "--fix",
      "second",
      "--",
      "test",
      "-f",
      "other.txt",
    );
    assert.equal(own.status, 0, own.stdout + own.stderr);
    const other = sh(
      "node",
      SCRIPT,
      "--fix",
      "second",
      "--",
      "grep",
      "-q",
      "fixed",
      "app.txt",
    );
    assert.equal(other.status, 1, other.stdout + other.stderr);
    assertBackAtHead();
  });

  it("with --fix, a later edit to the same file can't prove it", () => {
    const fix = (...check: string[]) =>
      sh("node", SCRIPT, "--fix", "shared", "--", ...check);
    assert.equal(fix("grep", "-q", "fixed-a", "shared.txt").status, 0);
    assert.equal(fix("grep", "-q", "later", "shared.txt").status, 1);
    assertBackAtHead();
  });

  it("rejects a check that passes without the fix", () => {
    const r = proof("grep", "-q", "check", "app.test.ts");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /also passes without the fix/);
  });

  it("cannot run when the check was interrupted", () => {
    const r = proof("sh", "interrupted.sh");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /interrupted/);
  });

  it("cannot run a check with an empty or whitespace argument", () => {
    for (const arg of ["fixed app", ""]) {
      const r = proof("grep", "-q", arg, "app.txt");
      assert.equal(r.status, 2);
      assert.match(r.stderr, /empty or contains whitespace/);
    }
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

  it("cannot run on a test-only commit and says it needs no proof", () => {
    write(
      "feature.test.js",
      `${readFileSync(join(repo, "feature.test.js"), "utf8")}// deflaked\n`,
    );
    sh("git", "commit", "-qam", "test-only");
    const r = sh("node", SCRIPT, "--fix", "HEAD", "--", "true");
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /no non-test changes[^\n]*test-only change needs no fix proof/,
    );
  });
});
