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

function parseUnifiedDiff(diff, cwd) {
  const result = new Map();
  let file = null;
  let line = 0;
  for (const raw of diff.split("\n")) {
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
