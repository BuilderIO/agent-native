#!/usr/bin/env node
// Proves a fix: the given command passes on HEAD and fails with this branch's
// non-test changes put back to their merge-base versions.
//
//   node scripts/fix-proof.ts [--base <ref>] -- <command...>
//
// Run from the repo root. A file this branch adds that the command names (a
// check helper such as `node scripts/check-x.ts`) stays at HEAD, like tests.
//
// Exit 0: proven (green on HEAD, red on base). Exit 1: not proven (red on
// HEAD, or the check still passes without the fix). Exit 2: could not run
// (dirty tree, no source changes, git failure, check missing on base).
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

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

function tryGit(...args: string[]) {
  return spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });
}

function git(...args: string[]): string {
  const r = tryGit(...args);
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
  return { status: r.status ?? 127, tail: out.slice(-12).join("\n") };
}

if (command.length === 0) couldNotRun("pass the check after `--`");
if (
  realpathSync(git("rev-parse", "--show-toplevel").trim()) !==
  realpathSync(process.cwd())
)
  couldNotRun("run from the repo root");
if (git("status", "--porcelain").trim())
  couldNotRun("commit or set aside local changes first");

const head = git("rev-parse", "HEAD").trim();
const base =
  baseFlag === -1
    ? git("merge-base", "HEAD", "origin/main").trim()
    : git("rev-parse", opts[baseFlag + 1]).trim();
const named = new Set(command.map((arg) => arg.replace(/^\.\//, "")));
// --no-renames reports a rename as an add plus a delete, so the old path
// comes back on the red run too.
const source = git("diff", "--name-status", "--no-renames", base, head)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, path] = line.split("\t");
    return { status, path };
  })
  .filter(
    ({ status, path }) =>
      !TEST_PATH.test(path) && !(status === "A" && named.has(path)),
  );
if (source.length === 0)
  couldNotRun(`no non-test changes between ${base.slice(0, 9)} and HEAD`);
const pathsWhere = (keep: (status: string) => boolean) =>
  source.filter(({ status }) => keep(status)).map(({ path }) => path);

const green = run();
if (green.status !== 0) {
  console.log(
    `fix-proof: NOT PROVEN, the check fails on HEAD ${head.slice(0, 9)}\n${green.tail}`,
  );
  process.exit(1);
}

// git checkout and git rm replace symlinks instead of writing through them.
let red: { status: number; tail: string } | undefined;
const restoreErrors: string[] = [];
try {
  const atBase = pathsWhere((s) => s !== "A");
  const addedOnBranch = pathsWhere((s) => s === "A");
  if (atBase.length) git("checkout", base, "--", ...atBase);
  if (addedOnBranch.length) git("rm", "-q", "-f", "--", ...addedOnBranch);
  red = run();
} finally {
  const atHead = pathsWhere((s) => s !== "D");
  const deletedOnBranch = pathsWhere((s) => s === "D");
  for (const args of [
    atHead.length ? ["checkout", head, "--", ...atHead] : null,
    deletedOnBranch.length
      ? ["rm", "-q", "-f", "--", ...deletedOnBranch]
      : null,
  ]) {
    if (!args) continue;
    const r = tryGit(...args);
    if (r.status !== 0)
      restoreErrors.push(`git ${args[0]}: ${r.stderr.trim()}`);
  }
}
const left = git("status", "--porcelain").trim();
if (restoreErrors.length || left)
  couldNotRun(
    `the tree did not return to HEAD ${head.slice(0, 9)}; restore it with \`git checkout ${head.slice(0, 9)} -- .\`\n${[...restoreErrors, left].filter(Boolean).join("\n")}`,
  );
if (!red) couldNotRun("the red run did not happen");

if (red.status === 127)
  couldNotRun(`\`${command[0]}\` is missing without the fix\n${red.tail}`);
if (red.status === 0) {
  console.log(
    `fix-proof: NOT PROVEN, the check also passes without the fix (${source.length} source files reverted to ${base.slice(0, 9)})`,
  );
  process.exit(1);
}
console.log(
  `fix-proof: proven, red at ${base.slice(0, 9)} (exit ${red.status}), green at ${head.slice(0, 9)}: ${command.join(" ")}\n--- red output ---\n${red.tail}`,
);
