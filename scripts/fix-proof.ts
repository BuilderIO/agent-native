#!/usr/bin/env node
// Proves a fix: the given command passes on HEAD and fails with the fix's
// non-test changes put back to what they were before it.
//
//   node scripts/fix-proof.ts --fix <commit> -- <command...>   one report's fix
//   node scripts/fix-proof.ts [--base <ref>] -- <command...>   the whole branch
//
// Run from the repo root. A check helper this branch adds and the command
// runs (`node scripts/check-x.ts`) stays at HEAD, like tests.
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
const fixFlag = opts.indexOf("--fix");

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
// Untracked files are ignored: git never touches them, and checks often
// write build output.
const trackedChanges = () => git("status", "--porcelain", "-uno").trim();
if (trackedChanges()) couldNotRun("commit or set aside local changes first");

const head = git("rev-parse", "HEAD").trim();
const fix = fixFlag === -1 ? null : git("rev-parse", opts[fixFlag + 1]).trim();
// With --fix, only that commit's files go back, to their state before it.
const base = fix
  ? git("rev-parse", `${fix}^`).trim()
  : baseFlag === -1
    ? git("merge-base", "HEAD", "origin/main").trim()
    : git("rev-parse", opts[baseFlag + 1]).trim();
// --no-renames reports a rename as an add plus a delete, so the old path
// comes back on the red run too.
const changes = git("diff", "--name-status", "--no-renames", base, fix ?? head)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, path] = line.split("\t");
    return { status, path };
  });
const added = new Set(
  changes.filter(({ status }) => status === "A").map(({ path }) => path),
);
// Only the script the command runs (its first or second word, when the fix
// adds it) stays at HEAD; any other argument is input and must be reverted.
const entryPoint = command
  .slice(0, 2)
  .map((arg) => arg.replace(/^\.\//, ""))
  .find((arg) => added.has(arg) && /\.([cm]?[jt]sx?|sh|py)$/.test(arg));
const source = changes.filter(
  ({ path }) => !TEST_PATH.test(path) && path !== entryPoint,
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
// Every step uses tryGit so a failure still reaches the restore below.
const gitErrors: string[] = [];
const step = (...args: string[]) => {
  const r = tryGit(...args);
  if (r.status !== 0)
    gitErrors.push(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.status === 0;
};
const atBase = pathsWhere((s) => s !== "A");
const addedOnBranch = pathsWhere((s) => s === "A");
// A signal during the red run reaches the check, not this process, so the
// restore below still runs. Only SIGKILL can skip it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {});
const reverted =
  (!atBase.length || step("checkout", base, "--", ...atBase)) &&
  (!addedOnBranch.length ||
    step("rm", "-q", "-f", "--ignore-unmatch", "--", ...addedOnBranch));
const red = reverted ? run() : undefined;
const all = source.map(({ path }) => path);
const listed = tryGit("ls-tree", "-r", "--name-only", head, "--", ...all);
if (listed.status !== 0) gitErrors.push(`git ls-tree: ${listed.stderr.trim()}`);
const atHead = new Set(listed.status === 0 ? listed.stdout.split("\n") : all);
const restore = all.filter((path) => atHead.has(path));
const absentAtHead = all.filter((path) => !atHead.has(path));
if (restore.length) step("checkout", head, "--", ...restore);
if (absentAtHead.length)
  step("rm", "-q", "-f", "--ignore-unmatch", "--", ...absentAtHead);
const left = trackedChanges();
if (gitErrors.length || left)
  couldNotRun(
    `${left ? `the tree did not return to HEAD ${head.slice(0, 9)}; restore it with \`git checkout ${head.slice(0, 9)} -- .\`\n` : ""}${[...gitErrors, left].filter(Boolean).join("\n")}`,
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
