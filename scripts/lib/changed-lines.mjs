/**
 * changed-lines.mjs
 *
 * Diff-scoped guard support. Some rules describe a habit we want to stop, not
 * a backlog we can clear — the repo already has thousands of `?? []` sites and
 * hundreds of raw colors. A guard that fails on all of them is a guard someone
 * turns off. These helpers let a guard fail only on lines this branch ADDED,
 * so the tenth instance cannot ship while the first nine stay a separate,
 * schedulable cleanup.
 */

import { execFileSync } from "node:child_process";

const DIFF_BASE_ENV = ["GUARD_DIFF_BASE", "GITHUB_BASE_REF"];

/**
 * Exit code a guard uses for "I could not run", as distinct from 0 (checked,
 * clean) and 1 (checked, violations). Without a third code every diff-scoped
 * guard has to pick between lying about a pass and failing the build on a
 * shallow clone, and all four picked the lie. `run-guards.ts` renders this as
 * SKIPPED and refuses to print "All checks passed" when any guard used it.
 */
export const GUARD_EXIT_COULD_NOT_RUN = 2;

/** Resolve the ref to diff against: explicit env, then origin/main, then main. */
export function resolveDiffBase(cwd) {
  for (const name of DIFF_BASE_ENV) {
    const value = process.env[name];
    if (value) return value.startsWith("origin/") ? value : `origin/${value}`;
  }
  for (const candidate of ["origin/main", "main"]) {
    if (git(["rev-parse", "--verify", "--quiet", candidate], cwd) !== null) {
      return candidate;
    }
  }
  return null;
}

/**
 * Lines added on this branch, as `{ [absolutePath]: Set<lineNumber> }`.
 * Returns null when the diff cannot be computed — callers must treat that as
 * "cannot tell", never as "nothing changed".
 */
export function addedLines(cwd, { includeWorkingTree = true } = {}) {
  const base = resolveDiffBase(cwd);
  if (!base) return null;
  const mergeBase = git(["merge-base", base, "HEAD"], cwd);
  if (mergeBase === null) return null;

  const args = ["diff", "--unified=0", "--no-color", "--diff-filter=ACMR"];
  if (!includeWorkingTree) args.push(mergeBase.trim(), "HEAD");
  else args.push(mergeBase.trim());

  const diff = git(args, cwd);
  if (diff === null) return null;
  return parseUnifiedDiff(diff, cwd);
}

/**
 * `addedLines`, but a guard that cannot scope itself exits instead of
 * continuing. Every diff-scoped guard used to hand-roll this and every one of
 * them printed a paragraph saying "this is NOT a pass" and then exited 0 —
 * the exact coercion CLAUDE.md's flagship rule bans, in the scripts that
 * enforce it. The caller gets a Map or it gets nothing.
 */
export function requireAddedLines(cwd, guardName, options) {
  const added = addedLines(cwd, options);
  if (added !== null) return added;
  console.error(
    `${guardName}: could not determine which lines this branch added ` +
      "(no GUARD_DIFF_BASE/GITHUB_BASE_REF, no origin/main or main ref, " +
      "git diff failed, or git reported a source file as binary), so the " +
      "check did not run.\n" +
      "  Fix with:  git fetch origin main   (or set GUARD_DIFF_BASE=<ref>)\n" +
      "  If a source file diffs as binary, it contains a NUL or other binary\n" +
      "  byte - find it with:  git diff --numstat   (look for '-' counts)",
  );
  process.exit(GUARD_EXIT_COULD_NOT_RUN);
}

/**
 * Extensions a guard is expected to inspect. A binary diff for one of these is
 * a guard that cannot see the file, not a file with nothing in it.
 */
const SOURCE_EXTENSIONS =
  /\.(?:tsx?|jsx?|mjs|cjs|mdx?|css|scss|json|ya?ml|html|sh)$/i;

export function parseUnifiedDiff(diff, cwd) {
  const result = new Map();
  let file = null;
  let line = 0;
  for (const raw of diff.split("\n")) {
    // Git emits no +++/@@/+ lines for a file it considers binary, so such a
    // file contributes nothing here and every diff-scoped guard passes having
    // inspected none of it. A single stray NUL byte is enough to mark a .ts
    // file binary, which is indistinguishable from a clean check. Refuse to
    // scope rather than report a pass over a file we never read.
    const binary = /^Binary files (?:a\/)?(.+?) and (?:b\/)?(.+?) differ$/.exec(
      raw,
    );
    if (
      binary &&
      (SOURCE_EXTENSIONS.test(binary[1]) || SOURCE_EXTENSIONS.test(binary[2]))
    ) {
      return null;
    }
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      file =
        target === "/dev/null" ? null : `${cwd}/${target.replace(/^b\//, "")}`;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      if (!result.has(file)) result.set(file, new Set());
      result.get(file).add(line);
      line += 1;
    }
  }
  return result;
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}
