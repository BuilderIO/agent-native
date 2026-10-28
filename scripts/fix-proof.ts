#!/usr/bin/env node
// Proves a fix: the given command passes on HEAD and fails with this branch's
// non-test changes put back to their merge-base versions.
//
//   node scripts/fix-proof.ts [--base <ref>] -- <command...>
//
// Exit 0: proven (green on HEAD, red on base). Exit 1: not proven (red on
// HEAD, or the check still passes without the fix). Exit 2: could not run
// (dirty tree, no source changes, git failure).
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";

const TEST_PATH =
  /(^|\/)(__tests__|e2e|tests?)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$|\.md$|^\.changeset\//;

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const opts = dash === -1 ? argv : argv.slice(0, dash);
const command = dash === -1 ? [] : argv.slice(dash + 1);
const baseFlag = opts.indexOf("--base");

function couldNotRun(message: string): never {
  console.error(`fix-proof: could not run: ${message}`);
  process.exit(2);
}

function git(...args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) couldNotRun(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

function run(): { status: number; tail: string } {
  const r = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 256 << 20,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd().split("\n");
  return { status: r.status ?? 1, tail: out.slice(-12).join("\n") };
}

if (command.length === 0) couldNotRun("pass the check after `--`");
if (git("status", "--porcelain").trim())
  couldNotRun("commit or set aside local changes first");

const head = git("rev-parse", "HEAD").trim();
const base =
  baseFlag === -1
    ? git("merge-base", "HEAD", "origin/main").trim()
    : git("rev-parse", opts[baseFlag + 1]).trim();
const source = git("diff", "--name-only", base, head)
  .split("\n")
  .filter((path) => path && !TEST_PATH.test(path));
if (source.length === 0)
  couldNotRun(`no non-test changes between ${base.slice(0, 9)} and HEAD`);

const green = run();
if (green.status !== 0) {
  console.log(
    `fix-proof: NOT PROVEN, the check fails on HEAD ${head.slice(0, 9)}\n${green.tail}`,
  );
  process.exit(1);
}

let red: { status: number; tail: string };
try {
  for (const path of source) {
    const atBase = spawnSync("git", ["show", `${base}:${path}`], {
      maxBuffer: 64 << 20,
    });
    if (atBase.status === 0) writeFileSync(path, atBase.stdout);
    else if (existsSync(path)) rmSync(path);
  }
  red = run();
} finally {
  git("checkout", head, "--", ...source);
}
if (git("status", "--porcelain").trim())
  couldNotRun("the tree did not return to HEAD; check `git status`");

if (red.status === 0) {
  console.log(
    `fix-proof: NOT PROVEN, the check also passes without the fix (${source.length} source files reverted to ${base.slice(0, 9)})`,
  );
  process.exit(1);
}
console.log(
  `fix-proof: proven, red at ${base.slice(0, 9)} (exit ${red.status}), green at ${head.slice(0, 9)}: ${command.join(" ")}\n--- red output ---\n${red.tail}`,
);
