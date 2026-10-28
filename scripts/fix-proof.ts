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

function run(): { status: number; signal: string | null; tail: string } {
  const r = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 256 << 20,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd().split("\n");
  return {
    status: r.status ?? 127,
    signal: r.signal,
    tail: out.slice(-12).join("\n"),
  };
}

if (command.length === 0) couldNotRun("pass the check after `--`");
// The proof line joins the command with spaces and CI splits it back, so an
// argument with whitespace would re-run as a different check.
if (command.some((arg) => /\s/.test(arg)))
  couldNotRun(
    "an argument contains whitespace, which the proof line can't carry; use a pattern without spaces or a script",
  );
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
const all = source.map(({ path }) => path);

// git checkout and git rm replace symlinks instead of writing through them.
// Every step uses tryGit so a failure still reaches the restore at the end.
const gitErrors: string[] = [];
function putAt(ref: string): boolean {
  const listed = tryGit("ls-tree", "-r", "--name-only", ref, "--", ...all);
  if (listed.status !== 0) {
    gitErrors.push(`git ls-tree ${ref}: ${listed.stderr.trim()}`);
    return false;
  }
  const present = new Set(listed.stdout.split("\n"));
  for (const args of [
    ["checkout", ref, "--", ...all.filter((path) => present.has(path))],
    [
      "rm",
      "-q",
      "-f",
      "--ignore-unmatch",
      "--",
      ...all.filter((path) => !present.has(path)),
    ],
  ]) {
    if (args.at(-1) === "--") continue;
    const r = tryGit(...args);
    if (r.status !== 0) {
      gitErrors.push(`git ${args[0]}: ${r.stderr.trim()}`);
      return false;
    }
  }
  return true;
}

// The handlers keep a signal from killing this process before the restore
// runs (spawnSync defers them until the check exits). A check that a Ctrl-C
// stopped exits 130 or 143, or by signal, and counts as could not run below.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {});
// With --fix, both runs differ only by that commit: green at the fix, red at
// its parent, so later edits to the same files can't decide the result.
const greenAt = fix ?? head;
const green = fix && fix !== head && !putAt(fix) ? undefined : run();
const red = green?.status === 0 && putAt(base) ? run() : undefined;
putAt(head);
const left = trackedChanges();
if (gitErrors.length || left)
  couldNotRun(
    `${left ? `the tree did not return to HEAD ${head.slice(0, 9)}; restore it with \`git checkout ${head.slice(0, 9)} -- .\`\n` : ""}${[...gitErrors, left].filter(Boolean).join("\n")}`,
  );
if (!green) couldNotRun("the green run did not happen");
for (const r of [green, red])
  if (r?.signal || r?.status === 130 || r?.status === 143)
    couldNotRun(
      `the check was interrupted (${r.signal ?? `exit ${r.status}`})`,
    );
if (green.status !== 0) {
  console.log(
    `fix-proof: NOT PROVEN, the check fails with the fix at ${greenAt.slice(0, 9)}\n${green.tail}`,
  );
  process.exit(1);
}
if (!red) couldNotRun("the red run did not happen");
if (red.status === 127)
  couldNotRun(`\`${command[0]}\` is missing without the fix\n${red.tail}`);
if (red.status === 0) {
  console.log(
    `fix-proof: NOT PROVEN, the check also passes without the fix (${source.length} source files at ${base.slice(0, 9)})`,
  );
  process.exit(1);
}
console.log(
  `fix-proof: proven, red at ${base.slice(0, 9)} (exit ${red.status}), green at ${greenAt.slice(0, 9)}: ${command.join(" ")}\n--- red output ---\n${red.tail}`,
);
